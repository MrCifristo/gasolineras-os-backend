import { Injectable, NotFoundException } from "@nestjs/common";
import { and, eq, sql } from "drizzle-orm";
import { DbService } from "../../db/db.service";
import { tiposVehiculo, vehiculos } from "../../db/schema";
import {
  errorPorTipoDuplicado,
  normalizarNombreTipo,
} from "./tipos-vehiculo.reglas";

@Injectable()
export class TiposVehiculoService {
  constructor(private db: DbService) {}

  /**
   * Los activos, por nombre sin mayúsculas: es la lista del formulario de
   * vehículos. COLLATE "C" para que el orden no dependa de la collation de la
   * base (el frontend lo reordena con las reglas del español al mostrarlo).
   */
  findAll() {
    return this.db.db
      .select()
      .from(tiposVehiculo)
      .where(eq(tiposVehiculo.activo, true))
      .orderBy(sql`lower(${tiposVehiculo.nombre}) COLLATE "C"`);
  }

  async create(nombreCrudo: string) {
    const nombre = normalizarNombreTipo(nombreCrudo);
    try {
      const [row] = await this.db.db
        .insert(tiposVehiculo)
        .values({ nombre })
        .returning();
      return row;
    } catch (e) {
      throw errorPorTipoDuplicado(e, nombre);
    }
  }

  /**
   * Renombra el tipo y, en la misma transacción, a los vehículos que lo
   * tienen: `vehiculos.tipo_vehiculo` es texto, y sin esto quedarían con el
   * nombre viejo y el formulario no lo encontraría en la lista.
   */
  async update(id: string, nombreCrudo: string) {
    const nombre = normalizarNombreTipo(nombreCrudo);
    try {
      return await this.db.db.transaction(async (tx) => {
        const [actual] = await tx
          .select()
          .from(tiposVehiculo)
          .where(and(eq(tiposVehiculo.id, id), eq(tiposVehiculo.activo, true)))
          .limit(1);
        if (!actual)
          throw new NotFoundException("Tipo de vehículo no encontrado");

        const [row] = await tx
          .update(tiposVehiculo)
          .set({ nombre })
          .where(eq(tiposVehiculo.id, id))
          .returning();
        if (actual.nombre !== nombre)
          await tx
            .update(vehiculos)
            .set({ tipo_vehiculo: nombre })
            .where(eq(vehiculos.tipo_vehiculo, actual.nombre));
        return row;
      });
    } catch (e) {
      throw errorPorTipoDuplicado(e, nombre);
    }
  }

  /** Lo saca de la lista; los vehículos que ya lo tienen lo conservan. */
  async remove(id: string) {
    const [row] = await this.db.db
      .update(tiposVehiculo)
      .set({ activo: false })
      .where(and(eq(tiposVehiculo.id, id), eq(tiposVehiculo.activo, true)))
      .returning();
    if (!row) throw new NotFoundException("Tipo de vehículo no encontrado");
    return row;
  }
}
