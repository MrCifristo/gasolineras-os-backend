import { Module } from "@nestjs/common";
import { DespachosExcelService } from "./despachos-excel.service";
import { DespachosController } from "./despachos.controller";
import { DespachosService } from "./despachos.service";

@Module({
  controllers: [DespachosController],
  providers: [DespachosService, DespachosExcelService],
  exports: [DespachosService],
})
export class DespachosModule {}
