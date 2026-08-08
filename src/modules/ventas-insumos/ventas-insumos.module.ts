import { Module } from "@nestjs/common";
import { VentasInsumosController } from "./ventas-insumos.controller";
import { VentasInsumosService } from "./ventas-insumos.service";

@Module({
  controllers: [VentasInsumosController],
  providers: [VentasInsumosService],
  exports: [VentasInsumosService],
})
export class VentasInsumosModule {}
