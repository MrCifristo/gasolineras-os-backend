import { Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { DbService } from "../../db/db.service";
import { configuracionSistema } from "../../db/schema";
import { UpdateConfiguracionDto } from "./dto/update-configuracion.dto";

@Injectable()
export class ConfiguracionSistemaService {
  constructor(private db: DbService) {}

  async findOne() {
    const [row] = await this.db.db.select().from(configuracionSistema).limit(1);
    if (row) return row;
    const [created] = await this.db.db
      .insert(configuracionSistema)
      .values({})
      .returning();
    return created;
  }

  async update(dto: UpdateConfiguracionDto, adminEmail: string) {
    const current = await this.findOne();
    const [updated] = await this.db.db
      .update(configuracionSistema)
      .set({
        sistema_bloqueado: dto.sistema_bloqueado,
        bloqueado_por: dto.sistema_bloqueado ? adminEmail : null,
        bloqueado_en: dto.sistema_bloqueado ? new Date() : null,
        updated_at: new Date(),
      })
      .where(eq(configuracionSistema.id, current.id))
      .returning();
    return updated;
  }
}
