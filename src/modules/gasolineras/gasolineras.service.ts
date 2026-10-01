import { Injectable, NotFoundException } from "@nestjs/common";
import { asc, eq } from "drizzle-orm";
import { DbService } from "../../db/db.service";
import { gasolineras, turnosGasolinera } from "../../db/schema";
import { TURNOS_POR_DEFECTO } from "../turnos/turnos.constants";
import { CreateGasolineraDto } from "./dto/create-gasolinera.dto";
import { UpdateGasolineraDto } from "./dto/update-gasolinera.dto";

@Injectable()
export class GasolinerasService {
  constructor(private db: DbService) {}

  findAll() {
    // Orden estable: sin él, los selectores y los desgloses del frontend
    // cambian de orden según el plan de Postgres.
    return this.db.db
      .select()
      .from(gasolineras)
      .where(eq(gasolineras.activo, true))
      .orderBy(asc(gasolineras.nombre));
  }

  async findOne(id: string) {
    const [row] = await this.db.db
      .select()
      .from(gasolineras)
      .where(eq(gasolineras.id, id))
      .limit(1);
    if (!row) throw new NotFoundException("Gasolinera no encontrada");
    return row;
  }

  async create(dto: CreateGasolineraDto) {
    // En la misma transacción: una gasolinera sin sus dos turnos rompería el
    // turno vigente del formulario y los recordatorios.
    return this.db.db.transaction(async (tx) => {
      const [row] = await tx.insert(gasolineras).values(dto).returning();
      await tx
        .insert(turnosGasolinera)
        .values(
          TURNOS_POR_DEFECTO.map((t) => ({ ...t, gasolinera_id: row.id })),
        );
      return row;
    });
  }

  async update(id: string, dto: UpdateGasolineraDto) {
    await this.findOne(id);
    const [row] = await this.db.db
      .update(gasolineras)
      .set(dto)
      .where(eq(gasolineras.id, id))
      .returning();
    return row;
  }

  async remove(id: string) {
    await this.findOne(id);
    const [row] = await this.db.db
      .update(gasolineras)
      .set({ activo: false })
      .where(eq(gasolineras.id, id))
      .returning();
    return row;
  }
}
