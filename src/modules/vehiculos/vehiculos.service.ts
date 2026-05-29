import { Injectable, NotFoundException } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { DbService } from "../../db/db.service";
import { vehiculos, pilotosVehiculos, pilotos } from "../../db/schema";
import { CreateVehiculoDto } from "./dto/create-vehiculo.dto";
import { UpdateVehiculoDto } from "./dto/update-vehiculo.dto";

@Injectable()
export class VehiculosService {
  constructor(private db: DbService) {}

  findAll(clienteId?: string, activo?: boolean) {
    const conditions = [eq(vehiculos.activo, activo ?? true)];
    if (clienteId) conditions.push(eq(vehiculos.cliente_id, clienteId));
    return this.db.db
      .select()
      .from(vehiculos)
      .where(and(...conditions));
  }

  async findOne(id: string) {
    const [row] = await this.db.db
      .select()
      .from(vehiculos)
      .where(eq(vehiculos.id, id))
      .limit(1);
    if (!row) throw new NotFoundException("Vehículo no encontrado");
    return row;
  }

  async create(dto: CreateVehiculoDto) {
    const [row] = await this.db.db.insert(vehiculos).values(dto).returning();
    return row;
  }

  async update(id: string, dto: UpdateVehiculoDto) {
    await this.findOne(id);
    const [row] = await this.db.db
      .update(vehiculos)
      .set(dto)
      .where(eq(vehiculos.id, id))
      .returning();
    return row;
  }

  async remove(id: string) {
    await this.findOne(id);
    const [row] = await this.db.db
      .update(vehiculos)
      .set({ activo: false })
      .where(eq(vehiculos.id, id))
      .returning();
    return row;
  }

  async asignarPiloto(vehiculoId: string, pilotoId: string) {
    await this.findOne(vehiculoId);
    const [row] = await this.db.db
      .insert(pilotosVehiculos)
      .values({ vehiculo_id: vehiculoId, piloto_id: pilotoId })
      .onConflictDoNothing()
      .returning();
    return row;
  }

  async desasignarPiloto(vehiculoId: string, pilotoId: string) {
    await this.db.db
      .delete(pilotosVehiculos)
      .where(
        and(
          eq(pilotosVehiculos.vehiculo_id, vehiculoId),
          eq(pilotosVehiculos.piloto_id, pilotoId),
        ),
      );
    return { message: "Piloto desasignado" };
  }

  async getPilotos(vehiculoId: string) {
    return this.db.db
      .select({ piloto: pilotos })
      .from(pilotosVehiculos)
      .innerJoin(pilotos, eq(pilotosVehiculos.piloto_id, pilotos.id))
      .where(eq(pilotosVehiculos.vehiculo_id, vehiculoId));
  }
}
