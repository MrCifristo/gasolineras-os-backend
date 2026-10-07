import { Injectable, NotFoundException } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { DbService } from "../../db/db.service";
import { pilotos, pilotosVehiculos, vehiculos } from "../../db/schema";
import { CreatePilotoDto } from "./dto/create-piloto.dto";
import { UpdatePilotoDto } from "./dto/update-piloto.dto";
import {
  clienteIdDeAlcancePiloto,
  clienteIdParaCrearPiloto,
  rechazarOtraEmpresaPiloto,
} from "./pilotos.reglas";

type Usuario = { rol: string; cliente_id?: string | null };

@Injectable()
export class PilotosService {
  constructor(private db: DbService) {}

  findAll(
    clienteId?: string,
    user?: { rol: string; cliente_id?: string | null },
  ) {
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

  async findOne(
    id: string,
    user?: { rol: string; cliente_id?: string | null },
  ) {
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

  async create(dto: CreatePilotoDto, user: Usuario) {
    const cliente_id = clienteIdParaCrearPiloto(user, dto.cliente_id);
    const [row] = await this.db.db
      .insert(pilotos)
      .values({ ...dto, cliente_id })
      .returning();
    return row;
  }

  /** Alcance fail-closed: el filtro por cliente_id va en el propio UPDATE. */
  async update(id: string, dto: UpdatePilotoDto, user: Usuario) {
    const clienteId = clienteIdDeAlcancePiloto(user);
    rechazarOtraEmpresaPiloto(user, dto.cliente_id);
    const condiciones = [eq(pilotos.id, id)];
    if (clienteId) condiciones.push(eq(pilotos.cliente_id, clienteId));
    if (Object.keys(dto).length === 0) {
      const [actual] = await this.db.db
        .select()
        .from(pilotos)
        .where(and(...condiciones))
        .limit(1);
      if (!actual) throw new NotFoundException("Piloto no encontrado");
      return actual;
    }
    const [row] = await this.db.db
      .update(pilotos)
      .set(dto)
      .where(and(...condiciones))
      .returning();
    if (!row) throw new NotFoundException("Piloto no encontrado");
    return row;
  }

  async remove(id: string, user: Usuario) {
    const clienteId = clienteIdDeAlcancePiloto(user);
    const condiciones = [eq(pilotos.id, id)];
    if (clienteId) condiciones.push(eq(pilotos.cliente_id, clienteId));
    const [row] = await this.db.db
      .update(pilotos)
      .set({ activo: false })
      .where(and(...condiciones))
      .returning();
    if (!row) throw new NotFoundException("Piloto no encontrado");
    return row;
  }
}
