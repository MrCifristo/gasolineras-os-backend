import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { DbService } from "../db/db.service";

/**
 * Healthcheck del despliegue. Railway no manda tráfico a una versión nueva
 * hasta que esto responde 200, así que toca la base: un backend que arrancó
 * pero no llega a Postgres no debe reemplazar al que sí funciona.
 * Público a propósito (sin @Auth) y sin datos.
 */
@Controller("salud")
export class SaludController {
  constructor(private readonly dbService: DbService) {}

  @Get()
  async verificar() {
    try {
      await this.dbService.db.execute(sql`SELECT 1`);
    } catch {
      throw new ServiceUnavailableException("Base de datos no disponible");
    }
    return { estado: "ok" };
  }
}
