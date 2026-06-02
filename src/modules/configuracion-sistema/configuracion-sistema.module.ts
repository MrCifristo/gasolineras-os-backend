import { Module } from "@nestjs/common";
import { DbModule } from "../../db/db.module";
import { ConfiguracionSistemaController } from "./configuracion-sistema.controller";
import { ConfiguracionSistemaService } from "./configuracion-sistema.service";

@Module({
  imports: [DbModule],
  controllers: [ConfiguracionSistemaController],
  providers: [ConfiguracionSistemaService],
})
export class ConfiguracionSistemaModule {}
