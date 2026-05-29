import { Module } from "@nestjs/common";
import { GasolinerasController } from "./gasolineras.controller";
import { GasolinerasService } from "./gasolineras.service";

@Module({
  controllers: [GasolinerasController],
  providers: [GasolinerasService],
  exports: [GasolinerasService],
})
export class GasolinerasModule {}
