import { Injectable, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DbService } from '../../db/db.service';
import { clientes, vehiculos, pilotos } from '../../db/schema';
import { CreateClienteDto } from './dto/create-cliente.dto';
import { UpdateClienteDto } from './dto/update-cliente.dto';

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
      .where(eq(clientes.id, id))
      .limit(1);
    if (!cliente) throw new NotFoundException('Cliente no encontrado');

    const [clienteVehiculos, clientePilotos] = await Promise.all([
      this.db.db
        .select()
        .from(vehiculos)
        .where(eq(vehiculos.cliente_id, id)),
      this.db.db
        .select()
        .from(pilotos)
        .where(eq(pilotos.cliente_id, id)),
    ]);

    return { ...cliente, vehiculos: clienteVehiculos, pilotos: clientePilotos };
  }

  async create(dto: CreateClienteDto) {
    const [row] = await this.db.db.insert(clientes).values(dto).returning();
    return row;
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
