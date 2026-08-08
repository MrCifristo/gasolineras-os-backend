import { Module } from "@nestjs/common";
import { OperariosController } from "./operarios.controller";
import { OperariosService } from "./operarios.service";

@Module({
  controllers: [OperariosController],
  providers: [OperariosService],
  exports: [OperariosService],
})
export class OperariosModule {}
