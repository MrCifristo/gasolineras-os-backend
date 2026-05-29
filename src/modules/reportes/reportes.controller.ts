import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Request,
  Res,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from "@nestjs/swagger";
import type { Response } from "express";
import { Auth } from "../../auth/roles.decorator";
import { GenerarPdfDto } from "./pdf/reportes-pdf.dto";
import { ReportesPdfService } from "./pdf/reportes-pdf.service";
import { ReportesService } from "./reportes.service";

@ApiTags("reportes")
@ApiBearerAuth("JWT")
@Controller("reportes")
export class ReportesController {
  constructor(
    private readonly service: ReportesService,
    private readonly pdfService: ReportesPdfService,
  ) {}

  @Post("pdf")
  @Auth("admin", "cliente")
  @ApiOperation({
    summary: "Genera reporte PDF ejecutivo (4 páginas, Corporate Blue)",
  })
  @ApiBody({ type: GenerarPdfDto })
  async generarPdf(
    @Body() dto: GenerarPdfDto,
    @Request() req: any,
    @Res() res: Response,
  ) {
    const pdf = await this.pdfService.generarPdf(dto, req.user);
    const fecha = new Date().toISOString().slice(0, 10);
    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="reporte-gasfuel-${fecha}.pdf"`,
      "Content-Length": pdf.length,
    });
    res.end(pdf);
  }

  @Get("resumen")
  @Auth("admin", "cliente")
  @ApiOperation({
    summary: "Resumen: total galones, monto, desglose por tipo y gasolinera",
  })
  @ApiQuery({ name: "cliente_id", required: false })
  @ApiQuery({ name: "gasolinera_id", required: false })
  @ApiQuery({ name: "fecha_desde", required: false })
  @ApiQuery({ name: "fecha_hasta", required: false })
  resumen(
    @Query("cliente_id") clienteId?: string,
    @Query("gasolinera_id") gasolineraId?: string,
    @Query("fecha_desde") fechaDesde?: string,
    @Query("fecha_hasta") fechaHasta?: string,
  ) {
    return this.service.resumen({
      cliente_id: clienteId,
      gasolinera_id: gasolineraId,
      fecha_desde: fechaDesde,
      fecha_hasta: fechaHasta,
    });
  }

  @Get("consumo-por-vehiculo")
  @Auth("admin", "cliente")
  @ApiOperation({ summary: "Ranking de vehículos por galones consumidos" })
  @ApiQuery({ name: "cliente_id", required: false })
  @ApiQuery({ name: "gasolinera_id", required: false })
  @ApiQuery({ name: "fecha_desde", required: false })
  @ApiQuery({ name: "fecha_hasta", required: false })
  consumoPorVehiculo(
    @Query("cliente_id") clienteId?: string,
    @Query("gasolinera_id") gasolineraId?: string,
    @Query("fecha_desde") fechaDesde?: string,
    @Query("fecha_hasta") fechaHasta?: string,
  ) {
    return this.service.consumoPorVehiculo({
      cliente_id: clienteId,
      gasolinera_id: gasolineraId,
      fecha_desde: fechaDesde,
      fecha_hasta: fechaHasta,
    });
  }

  @Get("consumo-por-piloto")
  @Auth("admin", "cliente")
  @ApiOperation({ summary: "Ranking de pilotos por galones consumidos" })
  @ApiQuery({ name: "cliente_id", required: false })
  @ApiQuery({ name: "gasolinera_id", required: false })
  @ApiQuery({ name: "fecha_desde", required: false })
  @ApiQuery({ name: "fecha_hasta", required: false })
  consumoPorPiloto(
    @Query("cliente_id") clienteId?: string,
    @Query("gasolinera_id") gasolineraId?: string,
    @Query("fecha_desde") fechaDesde?: string,
    @Query("fecha_hasta") fechaHasta?: string,
  ) {
    return this.service.consumoPorPiloto({
      cliente_id: clienteId,
      gasolinera_id: gasolineraId,
      fecha_desde: fechaDesde,
      fecha_hasta: fechaHasta,
    });
  }

  @Get("tendencia-mensual")
  @Auth("admin", "cliente")
  @ApiOperation({ summary: "Consumo agrupado por mes (últimos 12 meses)" })
  @ApiQuery({ name: "cliente_id", required: false })
  @ApiQuery({ name: "gasolinera_id", required: false })
  tendenciaMensual(
    @Query("cliente_id") clienteId?: string,
    @Query("gasolinera_id") gasolineraId?: string,
  ) {
    return this.service.tendenciaMensual({
      cliente_id: clienteId,
      gasolinera_id: gasolineraId,
    });
  }

  @Get("rendimiento-vehiculo/:vehiculoId")
  @Auth("admin", "cliente")
  @ApiOperation({
    summary: "Historial de km/galón por despacho para un vehículo",
  })
  rendimientoVehiculo(@Param("vehiculoId") vehiculoId: string) {
    return this.service.rendimientoVehiculo(vehiculoId);
  }
}
