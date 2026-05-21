import { Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { DbService } from '../../db/db.service';
import { preciosCombustible } from '../../db/schema';
import { CreatePrecioDto } from './dto/create-precio.dto';
import { UpdatePrecioDto } from './dto/update-precio.dto';

@Injectable()
export class PreciosCombustibleService {
  constructor(private db: DbService) {}

  findAll(gasolineraId?: string, fecha?: string) {
    const conditions: ReturnType<typeof eq>[] = [];
    if (gasolineraId) conditions.push(eq(preciosCombustible.gasolinera_id, gasolineraId));
    if (fecha) conditions.push(eq(preciosCombustible.fecha, fecha));
    return conditions.length
      ? this.db.db.select().from(preciosCombustible).where(and(...conditions))
      : this.db.db.select().from(preciosCombustible);
  }

  findHoy(gasolineraId: string) {
    const today = new Date().toISOString().split('T')[0];
    return this.db.db
      .select()
      .from(preciosCombustible)
      .where(
        and(
          eq(preciosCombustible.gasolinera_id, gasolineraId),
          eq(preciosCombustible.fecha, today),
        ),
      );
  }

  async findOne(id: string) {
    const [row] = await this.db.db
      .select()
      .from(preciosCombustible)
      .where(eq(preciosCombustible.id, id))
      .limit(1);
    if (!row) throw new NotFoundException('Precio no encontrado');
    return row;
  }

  async findByGasolineraFechaTipo(gasolineraId: string, fecha: string, tipo: string) {
    const [row] = await this.db.db
      .select()
      .from(preciosCombustible)
      .where(
        and(
          eq(preciosCombustible.gasolinera_id, gasolineraId),
          eq(preciosCombustible.fecha, fecha),
          eq(preciosCombustible.tipo_combustible, tipo),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async create(dto: CreatePrecioDto) {
    const [row] = await this.db.db.insert(preciosCombustible).values(dto).returning();
    return row;
  }

  async update(id: string, dto: UpdatePrecioDto) {
    await this.findOne(id);
    const [row] = await this.db.db
      .update(preciosCombustible)
      .set(dto)
      .where(eq(preciosCombustible.id, id))
      .returning();
    return row;
  }
}
