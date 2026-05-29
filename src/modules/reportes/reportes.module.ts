import { Module } from "@nestjs/common";
import { ReportesPdfService } from "./pdf/reportes-pdf.service";
import { ReportesController } from "./reportes.controller";
import { ReportesService } from "./reportes.service";

@Module({
  controllers: [ReportesController],
  providers: [ReportesService, ReportesPdfService],
})
export class ReportesModule {}
