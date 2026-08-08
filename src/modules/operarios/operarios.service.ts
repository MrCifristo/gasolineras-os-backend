import { Injectable, NotFoundException } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { DbService } from "../../db/db.service";
import { operarios } from "../../db/schema";
import { CreateOperarioDto } from "./dto/create-operario.dto";
import { UpdateOperarioDto } from "./dto/update-operario.dto";

@Injectable()
export class OperariosService {
  constructor(private db: DbService) {}

  findAll(gasolineraId?: string) {
    if (gasolineraId) {
      return this.db.db
        .select()
        .from(operarios)
        .where(
          and(
            eq(operarios.gasolinera_id, gasolineraId),
            eq(operarios.activo, true),
          ),
        );
    }
    return this.db.db
      .select()
      .from(operarios)
      .where(eq(operarios.activo, true));
  }

  async findOne(id: string) {
    const [operario] = await this.db.db
      .select()
      .from(operarios)
      .where(eq(operarios.id, id))
      .limit(1);
    if (!operario) throw new NotFoundException("Operario no encontrado");
    return operario;
  }

  async create(dto: CreateOperarioDto) {
    const [row] = await this.db.db.insert(operarios).values(dto).returning();
    return row;
  }

  async update(id: string, dto: UpdateOperarioDto) {
    await this.findOne(id);
    const [row] = await this.db.db
      .update(operarios)
      .set(dto)
      .where(eq(operarios.id, id))
      .returning();
    return row;
  }

  async remove(id: string) {
    await this.findOne(id);
    const [row] = await this.db.db
      .update(operarios)
      .set({ activo: false })
      .where(eq(operarios.id, id))
      .returning();
    return row;
  }
}
