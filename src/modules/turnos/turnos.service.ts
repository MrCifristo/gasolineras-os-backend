// src/modules/turnos/turnos.service.ts
import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { and, asc, eq } from "drizzle-orm";
import { DbService } from "../../db/db.service";
import { turnosGasolinera } from "../../db/schema";
import { ahoraGuatemala } from "../../common/hora-guatemala";
import { TURNOS, type Turno } from "./turnos.constants";
import { seSolapan, turnoEnMinuto } from "./turnos.util";
import { UpdateTurnoDto } from "./dto/update-turno.dto";

export interface FilaTurno {
  id: string;
  gasolinera_id: string;
  turno: Turno;
  hora_inicio: string;
  hora_fin: string;
  recordatorio_activo: boolean;
  updated_at: Date | null;
}

/** Postgres devuelve `time` como "06:00:00"; el contrato habla en HH:mm. */
export function aFila(row: typeof turnosGasolinera.$inferSelect): FilaTurno {
  return {
    ...row,
    turno: row.turno as Turno,
    hora_inicio: row.hora_inicio.slice(0, 5),
    hora_fin: row.hora_fin.slice(0, 5),
  };
}

@Injectable()
export class TurnosService {
  constructor(private db: DbService) {}

  async listar(gasolineraId: string): Promise<FilaTurno[]> {
    const rows = await this.db.db
      .select()
      .from(turnosGasolinera)
      .where(eq(turnosGasolinera.gasolinera_id, gasolineraId))
      // 'manana' < 'tarde' alfabéticamente: el orden sale gratis.
      .orderBy(asc(turnosGasolinera.turno));
    if (!rows.length) throw new NotFoundException("Gasolinera no encontrada");
    return rows.map(aFila);
  }

  async actualizar(gasolineraId: string, turno: string, dto: UpdateTurnoDto): Promise<FilaTurno> {
    if (!(TURNOS as readonly string[]).includes(turno)) {
      throw new BadRequestException("El turno debe ser 'manana' o 'tarde'");
    }
    if (
      dto.hora_inicio === undefined &&
      dto.hora_fin === undefined &&
      dto.recordatorio_activo === undefined
    ) {
      throw new BadRequestException("No hay cambios que guardar");
    }

    const turnos = await this.listar(gasolineraId);
    const actual = turnos.find((t) => t.turno === turno)!;
    const otro = turnos.find((t) => t.turno !== turno)!;
    const nuevo = {
      hora_inicio: dto.hora_inicio ?? actual.hora_inicio,
      hora_fin: dto.hora_fin ?? actual.hora_fin,
    };

    if (nuevo.hora_inicio === nuevo.hora_fin) {
      throw new BadRequestException("La hora de inicio y la de fin no pueden ser iguales");
    }
    if (seSolapan(nuevo, otro)) {
      throw new BadRequestException(
        `El turno se solapa con el turno ${otro.turno === "manana" ? "de la mañana" : "de la tarde"} (${otro.hora_inicio}–${otro.hora_fin})`,
      );
    }

    const [row] = await this.db.db
      .update(turnosGasolinera)
      .set({ ...nuevo, recordatorio_activo: dto.recordatorio_activo ?? actual.recordatorio_activo, updated_at: new Date() })
      .where(and(eq(turnosGasolinera.gasolinera_id, gasolineraId), eq(turnosGasolinera.turno, turno)))
      .returning();
    return aFila(row);
  }

  async turnoActual(gasolineraId: string, ahoraUtc: Date = new Date()): Promise<{ turno: Turno | null }> {
    const turnos = await this.listar(gasolineraId);
    const hit = turnoEnMinuto(turnos, ahoraGuatemala(ahoraUtc).minutos);
    return { turno: hit?.turno ?? null };
  }
}
