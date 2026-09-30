// src/modules/turnos/recordatorios.service.ts
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Cron, CronExpression } from "@nestjs/schedule";
import { and, eq, inArray } from "drizzle-orm";
import { DbService } from "../../db/db.service";
import {
  gasolineras,
  preciosCombustible,
  recordatoriosTurno,
  turnosGasolinera,
  usuarios,
} from "../../db/schema";
import { MailService } from "../../mail/mail.service";
import { SuscripcionesPushService } from "../push/suscripciones-push.service";
import { armarRecordatorio } from "./recordatorio.mensaje";
import type { Turno } from "./turnos.constants";
import { debeRecordar } from "./turnos.util";

interface Candidato {
  gasolinera_id: string;
  gasolinera: string;
  turno: Turno;
  hora_inicio: string;
}

interface Enviado {
  gasolinera_id: string;
  turno: string;
  fecha: string;
  correos: number;
  push: number;
}

/**
 * Aviso de precios 30 minutos antes de cada turno.
 *
 * El cron sólo despierta cada minuto: @nestjs/schedule corre en la zona del
 * proceso, así que ninguna decisión se toma con la hora local. Toda la lógica
 * vive en ejecutar(ahoraUtc), que los tests llaman con un instante fijo.
 *
 * Garantía: como mucho una vez por (gasolinera, turno, fecha). Si el proceso
 * muere entre reclamar la fila y enviar, ese aviso se pierde; se prefiere eso
 * a reintentar y mandar duplicados.
 */
@Injectable()
export class RecordatoriosService {
  private readonly logger = new Logger(RecordatoriosService.name);

  constructor(
    private db: DbService,
    private config: ConfigService,
    private mail: MailService,
    private suscripciones: SuscripcionesPushService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async tick(): Promise<void> {
    if (this.config.get<string>("RECORDATORIOS_ACTIVOS") === "false") return;
    try {
      await this.ejecutar(new Date());
    } catch (e) {
      this.logger.error(`Tick de recordatorios falló: ${(e as Error).message}`);
    }
  }

  async ejecutar(ahoraUtc: Date): Promise<{ enviados: Enviado[] }> {
    const enviados: Enviado[] = [];
    for (const c of await this.turnosCandidatos()) {
      const toca = debeRecordar(ahoraUtc, c.hora_inicio);
      if (!toca) continue;
      try {
        const r = await this.procesarTurno(c, toca.fecha);
        if (r) enviados.push(r);
      } catch (e) {
        this.logger.error(
          `Recordatorio ${c.gasolinera_id}/${c.turno} falló: ${(e as Error).message}`,
        );
      }
    }
    return { enviados };
  }

  private async turnosCandidatos(): Promise<Candidato[]> {
    const rows = await this.db.db
      .select({
        gasolinera_id: turnosGasolinera.gasolinera_id,
        gasolinera: gasolineras.nombre,
        turno: turnosGasolinera.turno,
        hora_inicio: turnosGasolinera.hora_inicio,
      })
      .from(turnosGasolinera)
      .innerJoin(
        gasolineras,
        eq(turnosGasolinera.gasolinera_id, gasolineras.id),
      )
      .where(
        and(
          eq(turnosGasolinera.recordatorio_activo, true),
          eq(gasolineras.activo, true),
          eq(gasolineras.bloqueado, false),
        ),
      );
    return rows.map((r) => ({
      ...r,
      turno: r.turno as Turno,
      hora_inicio: r.hora_inicio.slice(0, 5),
    }));
  }

  private async procesarTurno(
    c: Candidato,
    fecha: string,
  ): Promise<Enviado | null> {
    // El candado: sólo quien inserta la fila envía.
    const [reclamo] = await this.db.db
      .insert(recordatoriosTurno)
      .values({ gasolinera_id: c.gasolinera_id, turno: c.turno, fecha })
      .onConflictDoNothing({
        target: [
          recordatoriosTurno.gasolinera_id,
          recordatoriosTurno.turno,
          recordatoriosTurno.fecha,
        ],
      })
      .returning({ id: recordatoriosTurno.id });
    if (!reclamo) return null;

    // Precios del día en que arranca el turno (fecha GT), no del día UTC.
    const precios = await this.db.db
      .select({
        tipo_combustible: preciosCombustible.tipo_combustible,
        precio_galon: preciosCombustible.precio_galon,
      })
      .from(preciosCombustible)
      .where(
        and(
          eq(preciosCombustible.gasolinera_id, c.gasolinera_id),
          eq(preciosCombustible.fecha, fecha),
        ),
      );

    const destinatarios = await this.db.db
      .select({ id: usuarios.id, email: usuarios.email, rol: usuarios.rol })
      .from(usuarios)
      .where(
        and(
          inArray(usuarios.rol, ["admin", "jefe_pista"]),
          eq(usuarios.activo, true),
        ),
      );

    const frontendUrl = this.config.get<string>("FRONTEND_URL") ?? "";
    const mensajePara = (rol: string) =>
      armarRecordatorio({
        gasolinera: c.gasolinera,
        turno: c.turno,
        horaInicio: c.hora_inicio,
        precios,
        frontendUrl,
        rol: rol === "jefe_pista" ? "jefe_pista" : "admin",
      });

    // Canales independientes: un fallo de Resend no frena el push, y al revés.
    let correos = 0;
    for (const d of destinatarios) {
      if (!d.email) continue;
      const m = mensajePara(d.rol);
      try {
        await this.mail.enviar({
          para: d.email,
          asunto: m.asunto,
          html: m.html,
          texto: m.texto,
        });
        correos++;
      } catch (e) {
        this.logger.error(
          `Correo de recordatorio a ${d.id} falló: ${(e as Error).message}`,
        );
      }
    }

    let push = 0;
    try {
      const rolPorId = new Map(destinatarios.map((d) => [d.id, d.rol]));
      push = await this.suscripciones.enviarAUsuarios(
        destinatarios.map((d) => d.id),
        (id) => mensajePara(rolPorId.get(id) ?? "admin").push,
      );
    } catch (e) {
      this.logger.error(`Push de recordatorio falló: ${(e as Error).message}`);
    }

    await this.db.db
      .update(recordatoriosTurno)
      .set({ correos_enviados: correos, push_enviados: push })
      .where(eq(recordatoriosTurno.id, reclamo.id));

    return {
      gasolinera_id: c.gasolinera_id,
      turno: c.turno,
      fecha,
      correos,
      push,
    };
  }
}
