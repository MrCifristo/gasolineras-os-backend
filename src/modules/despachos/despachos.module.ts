import { Module } from "@nestjs/common";
import { DespachosExcelService } from "./despachos-excel.service";
import { DespachosController } from "./despachos.controller";
import { DespachosService } from "./despachos.service";
import { ValesPdfService } from "./vales-pdf.service";

@Module({
  controllers: [DespachosController],
  providers: [DespachosService, DespachosExcelService, ValesPdfService],
  exports: [DespachosService],
})
export class DespachosModule {}
