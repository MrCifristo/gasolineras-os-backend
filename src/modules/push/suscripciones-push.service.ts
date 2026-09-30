import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { and, eq, inArray } from "drizzle-orm";
import { DbService } from "../../db/db.service";
import { suscripcionesPush } from "../../db/schema";
import { PushService, type MensajePush } from "../../push/push.service";
import { CrearSuscripcionDto } from "./dto/crear-suscripcion.dto";

@Injectable()
export class SuscripcionesPushService {
  private readonly logger = new Logger(SuscripcionesPushService.name);

  constructor(
    private db: DbService,
    private push: PushService,
  ) {}

  async guardar(
    usuarioId: string,
    dto: CrearSuscripcionDto,
    userAgent?: string,
  ) {
    // Upsert por endpoint: un navegador tiene un solo endpoint, y si cambia de
    // usuario la suscripción tiene que seguir al que inició sesión ahora.
    await this.db.db
      .insert(suscripcionesPush)
      .values({
        usuario_id: usuarioId,
        endpoint: dto.endpoint,
        p256dh: dto.keys.p256dh,
        auth: dto.keys.auth,
        user_agent: userAgent?.slice(0, 255),
      })
      .onConflictDoUpdate({
        target: suscripcionesPush.endpoint,
        set: {
          usuario_id: usuarioId,
          p256dh: dto.keys.p256dh,
          auth: dto.keys.auth,
          user_agent: userAgent?.slice(0, 255),
        },
      });
    return { ok: true };
  }

  async borrar(usuarioId: string, endpoint: string) {
    const borradas = await this.db.db
      .delete(suscripcionesPush)
      .where(
        and(
          eq(suscripcionesPush.endpoint, endpoint),
          eq(suscripcionesPush.usuario_id, usuarioId),
        ),
      )
      .returning({ id: suscripcionesPush.id });
    if (!borradas.length)
      throw new NotFoundException("Suscripción no encontrada");
    return { ok: true };
  }

  /** Envía a todas las suscripciones de esos usuarios. Devuelve los envíos 'ok'. */
  async enviarAUsuarios(
    usuarioIds: string[],
    mensajePorUsuario: (usuarioId: string) => MensajePush,
  ): Promise<number> {
    if (!usuarioIds.length || !this.push.clavePublica()) return 0;
    const subs = await this.db.db
      .select()
      .from(suscripcionesPush)
      .where(inArray(suscripcionesPush.usuario_id, usuarioIds));
    let ok = 0;
    for (const s of subs) {
      const r = await this.push.enviar(s, mensajePorUsuario(s.usuario_id));
      if (r === "ok") ok++;
      if (r === "expirada") {
        await this.db.db
          .delete(suscripcionesPush)
          .where(eq(suscripcionesPush.id, s.id));
        this.logger.log(`Suscripción push expirada eliminada (${s.id})`);
      }
    }
    return ok;
  }
}
