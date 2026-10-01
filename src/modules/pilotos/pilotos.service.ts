import { Injectable, NotFoundException } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { DbService } from "../../db/db.service";
import { pilotos, pilotosVehiculos, vehiculos } from "../../db/schema";
import { CreatePilotoDto } from "./dto/create-piloto.dto";
import { UpdatePilotoDto } from "./dto/update-piloto.dto";

@Injectable()
export class PilotosService {
  constructor(private db: DbService) {}

  findAll(clienteId?: string, user?: { rol: string; cliente_id?: string | null }) {
    if (user?.rol === "cliente") {
      if (!user.cliente_id) return Promise.resolve([]);
      clienteId = user.cliente_id;
    }
    if (clienteId) {
      return this.db.db
        .select()
        .from(pilotos)
        .where(
          and(eq(pilotos.cliente_id, clienteId), eq(pilotos.activo, true)),
        );
    }
    return this.db.db.select().from(pilotos).where(eq(pilotos.activo, true));
  }

  async findOne(id: string, user?: { rol: string; cliente_id?: string | null }) {
    const condiciones = [eq(pilotos.id, id)];
    if (user?.rol === "cliente") {
      if (!user.cliente_id) throw new NotFoundException("Piloto no encontrado");
      condiciones.push(eq(pilotos.cliente_id, user.cliente_id));
    }
    const [piloto] = await this.db.db
      .select()
      .from(pilotos)
      .where(and(...condiciones))
      .limit(1);
    if (!piloto) throw new NotFoundException("Piloto no encontrado");

    const pilotoVehiculos = await this.db.db
      .select({ vehiculo: vehiculos })
      .from(pilotosVehiculos)
      .innerJoin(vehiculos, eq(pilotosVehiculos.vehiculo_id, vehiculos.id))
      .where(eq(pilotosVehiculos.piloto_id, id));

    return { ...piloto, vehiculos: pilotoVehiculos.map((r) => r.vehiculo) };
  }

  async create(dto: CreatePilotoDto) {
    const [row] = await this.db.db.insert(pilotos).values(dto).returning();
    return row;
  }

  async update(id: string, dto: UpdatePilotoDto) {
    await this.findOne(id);
    const [row] = await this.db.db
      .update(pilotos)
      .set(dto)
      .where(eq(pilotos.id, id))
      .returning();
    return row;
  }

  async remove(id: string) {
    await this.findOne(id);
    const [row] = await this.db.db
      .update(pilotos)
      .set({ activo: false })
      .where(eq(pilotos.id, id))
      .returning();
    return row;
  }
}
