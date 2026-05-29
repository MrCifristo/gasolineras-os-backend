import { Injectable, NotFoundException } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { DbService } from "../../db/db.service";
import { clientes, vehiculos, pilotos, saldosCliente } from "../../db/schema";
import { CreateClienteDto } from "./dto/create-cliente.dto";
import { UpdateClienteDto } from "./dto/update-cliente.dto";

@Injectable()
export class ClientesService {
  constructor(private db: DbService) {}

  findAll() {
    return this.db.db.select().from(clientes).where(eq(clientes.activo, true));
  }

  async findOne(id: string) {
    const [cliente] = await this.db.db
      .select()
      .from(clientes)
      .where(and(eq(clientes.id, id), eq(clientes.activo, true)))
      .limit(1);
    if (!cliente) throw new NotFoundException("Cliente no encontrado");

    const [clienteVehiculos, clientePilotos] = await Promise.all([
      this.db.db
        .select()
        .from(vehiculos)
        .where(and(eq(vehiculos.cliente_id, id), eq(vehiculos.activo, true))),
      this.db.db
        .select()
        .from(pilotos)
        .where(and(eq(pilotos.cliente_id, id), eq(pilotos.activo, true))),
    ]);

    return { ...cliente, vehiculos: clienteVehiculos, pilotos: clientePilotos };
  }

  async create(dto: CreateClienteDto) {
    return this.db.db.transaction(async (tx) => {
      const [cliente] = await tx.insert(clientes).values(dto).returning();
      // Crear el saldo inicial en 0 para que los despachos puedan descontarse correctamente
      await tx.insert(saldosCliente).values({ cliente_id: cliente.id });
      return cliente;
    });
  }

  async update(id: string, dto: UpdateClienteDto) {
    await this.findOne(id);
    const [row] = await this.db.db
      .update(clientes)
      .set(dto)
      .where(eq(clientes.id, id))
      .returning();
    return row;
  }

  async remove(id: string) {
    await this.findOne(id);
    const [row] = await this.db.db
      .update(clientes)
      .set({ activo: false })
      .where(eq(clientes.id, id))
      .returning();
    return row;
  }
}
