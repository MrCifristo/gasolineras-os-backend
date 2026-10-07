import { Injectable, UnauthorizedException } from "@nestjs/common";
import { randomBytes, createHash } from "node:crypto";
import { and, eq, isNull, lt } from "drizzle-orm";
import { DbService } from "../db/db.service";
import { sesiones, usuarios } from "../db/schema";
import {
  ReplayError,
  sesionPosteriorAlPassword,
  validarSesionParaRotar,
  validarUsuarioDeSesion,
  vencimientoRotado,
  vencimientosIniciales,
} from "./session.reglas";

type Usuario = typeof usuarios.$inferSelect;

export interface SesionCreada {
  sid: string;
  refreshToken: string;
  refreshExpiraAt: Date;
}

export interface MetaSesion {
  userAgent?: string | null;
  ip?: string | null;
}

@Injectable()
export class SessionService {
  constructor(private readonly db: DbService) {}

  /** El token viaja al cliente una sola vez; en la base sólo queda su SHA-256. */
  private generarToken(): { plano: string; hash: string } {
    const plano = randomBytes(32).toString("base64url");
    return { plano, hash: this.hashear(plano) };
  }

  private hashear(tokenPlano: string): string {
    // SHA-256 y no argon2: el token ya son 256 bits aleatorios, así que no hay
    // nada que un hash lento proteja, y se pagaría en cada refresh.
    return createHash("sha256").update(tokenPlano).digest("hex");
  }

  /** Abre una familia nueva. Es el camino del login. */
  async crear(usuario: Usuario, meta: MetaSesion = {}): Promise<SesionCreada> {
    const { plano, hash } = this.generarToken();
    const ahora = new Date();
    const { expira, familiaExpira } = vencimientosIniciales(usuario.rol, ahora);

    const [fila] = await this.db.db
      .insert(sesiones)
      .values({
        usuario_id: usuario.id,
        refresh_token_hash: hash,
        familia_id: crypto.randomUUID(),
        expira_at: expira,
        familia_expira_at: familiaExpira,
        user_agent: meta.userAgent?.slice(0, 255) ?? null,
        ip: meta.ip?.slice(0, 45) ?? null,
      })
      .returning();

    return { sid: fila.id, refreshToken: plano, refreshExpiraAt: expira };
  }

  /**
   * Consume un refresh y emite el siguiente de la misma familia.
   *
   * Todo pasa dentro de una transacción con FOR UPDATE sobre la fila: dos
   * refresh concurrentes (la tablet disparando dos requests a la vez) se
   * serializan en vez de que ambos se crean válidos y uno termine marcando
   * replay contra el otro.
   */
  async rotar(
    tokenPlano: string,
    meta: MetaSesion = {},
  ): Promise<{ usuario: Usuario; sesion: SesionCreada }> {
    const hash = this.hashear(tokenPlano);

    try {
      return await this.rotarEnTx(hash, meta);
    } catch (e) {
      if (e instanceof ReplayError) {
        // Fuera de la transacción abortada, así la revocación sí persiste.
        await this.revocarFamilia(e.familiaId);
        throw new UnauthorizedException("Sesión reutilizada: familia revocada");
      }
      throw e;
    }
  }

  private async revocarFamilia(familiaId: string): Promise<void> {
    await this.db.db
      .update(sesiones)
      .set({ revocado_at: new Date() })
      .where(
        and(eq(sesiones.familia_id, familiaId), isNull(sesiones.revocado_at)),
      );
  }

  private rotarEnTx(
    hash: string,
    meta: MetaSesion,
  ): Promise<{ usuario: Usuario; sesion: SesionCreada }> {
    return this.db.db.transaction(async (tx) => {
      const [sesion] = await tx
        .select()
        .from(sesiones)
        .where(eq(sesiones.refresh_token_hash, hash))
        .for("update")
        .limit(1);

      const ahora = new Date();
      // Un replay lanza ReplayError y la familia NO se revoca aquí: lanzar la
      // excepción haría rollback y la familia quedaría viva. Se marca la familia
      // y se revoca fuera, tras cerrar la tx (ver `rotar`).
      validarSesionParaRotar(sesion, ahora);

      const [usuario] = await tx
        .select()
        .from(usuarios)
        .where(eq(usuarios.id, sesion.usuario_id))
        .limit(1);

      validarUsuarioDeSesion(usuario, sesion.creado_at);

      await tx
        .update(sesiones)
        .set({ usado_at: ahora, ultimo_uso_at: ahora })
        .where(eq(sesiones.id, sesion.id));

      const { plano, hash: nuevoHash } = this.generarToken();
      const expira = vencimientoRotado(
        usuario.rol,
        ahora,
        sesion.familia_expira_at,
      );

      const [nueva] = await tx
        .insert(sesiones)
        .values({
          usuario_id: usuario.id,
          refresh_token_hash: nuevoHash,
          familia_id: sesion.familia_id,
          expira_at: expira,
          familia_expira_at: sesion.familia_expira_at,
          user_agent: meta.userAgent?.slice(0, 255) ?? sesion.user_agent,
          ip: meta.ip?.slice(0, 45) ?? sesion.ip,
        })
        .returning();

      return {
        usuario,
        sesion: { sid: nueva.id, refreshToken: plano, refreshExpiraAt: expira },
      };
    });
  }

  /**
   * Resuelve el usuario detrás de un `sid` vivo. Lo usa el guard en cada
   * request: sin esto, un access token de una sesión revocada seguiría
   * sirviendo hasta 15 minutos y la revocación sería decorativa.
   */
  async usuarioDeSesionViva(sid: string): Promise<Usuario | null> {
    const [fila] = await this.db.db
      .select({ usuario: usuarios, creado_at: sesiones.creado_at })
      .from(sesiones)
      .innerJoin(usuarios, eq(usuarios.id, sesiones.usuario_id))
      .where(
        and(
          eq(sesiones.id, sid),
          isNull(sesiones.revocado_at),
          eq(usuarios.activo, true),
        ),
      )
      .limit(1);

    if (!fila) return null;
    // La familia puede haber caído por replay aunque el access siga vigente.
    if (
      !sesionPosteriorAlPassword(
        fila.creado_at,
        fila.usuario.password_actualizado_at,
      )
    ) {
      return null;
    }
    return fila.usuario;
  }

  /** Logout: revoca la familia entera, no sólo el eslabón actual. */
  async revocarPorSid(sid: string): Promise<void> {
    const [sesion] = await this.db.db
      .select({ familia_id: sesiones.familia_id })
      .from(sesiones)
      .where(eq(sesiones.id, sid))
      .limit(1);

    if (!sesion) return;
    await this.revocarFamilia(sesion.familia_id);
  }

  /** "Cerrar sesión en todos lados", y lo que se dispara al cambiar la contraseña. */
  async revocarTodasDelUsuario(usuarioId: string): Promise<void> {
    await this.db.db
      .update(sesiones)
      .set({ revocado_at: new Date() })
      .where(
        and(eq(sesiones.usuario_id, usuarioId), isNull(sesiones.revocado_at)),
      );
  }

  /** Higiene: las filas expiradas no aportan nada una vez vencidas. */
  async limpiarExpiradas(): Promise<number> {
    const borradas = await this.db.db
      .delete(sesiones)
      .where(lt(sesiones.familia_expira_at, new Date()))
      .returning({ id: sesiones.id });
    return borradas.length;
  }
}
