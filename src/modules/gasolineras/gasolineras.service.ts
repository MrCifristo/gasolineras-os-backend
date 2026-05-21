import { Injectable, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DbService } from '../../db/db.service';
import { gasolineras } from '../../db/schema';
import { CreateGasolineraDto } from './dto/create-gasolinera.dto';
import { UpdateGasolineraDto } from './dto/update-gasolinera.dto';

@Injectable()
export class GasolinerasService {
  constructor(private db: DbService) {}

  findAll() {
    return this.db.db.select().from(gasolineras).where(eq(gasolineras.activo, true));
  }

  async findOne(id: string) {
    const [row] = await this.db.db
      .select()
      .from(gasolineras)
      .where(eq(gasolineras.id, id))
      .limit(1);
    if (!row) throw new NotFoundException('Gasolinera no encontrada');
    return row;
  }

  async create(dto: CreateGasolineraDto) {
    const [row] = await this.db.db.insert(gasolineras).values(dto).returning();
    return row;
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
