import { Module } from "@nestjs/common";
import { TiposVehiculoController } from "./tipos-vehiculo.controller";
import { TiposVehiculoService } from "./tipos-vehiculo.service";

@Module({
  controllers: [TiposVehiculoController],
  providers: [TiposVehiculoService],
})
export class TiposVehiculoModule {}
