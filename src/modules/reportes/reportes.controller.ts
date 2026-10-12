import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Query,
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
import { UsuarioActual, type UsuarioSesion } from "../../auth/usuario-actual";

@ApiTags("reportes")
@ApiBearerAuth("JWT")
@Controller("reportes")
export class ReportesController {
  constructor(
    private readonly service: ReportesService,
    private readonly pdfService: ReportesPdfService,
  ) {}

  /**
   * Alcance fail-closed: un cliente sólo ve sus propios despachos; el
   * cliente_id del query se ignora. Sin cliente_id propio, 403.
   */
  private acotar<T extends { cliente_id?: string }>(
    user: { rol: string; cliente_id?: string | null } | undefined,
    filtros: T,
  ): T {
    if (user?.rol !== "cliente") return filtros;
    if (!user.cliente_id)
      throw new ForbiddenException("Cliente sin empresa asignada");
    return { ...filtros, cliente_id: user.cliente_id };
  }

  @Post("pdf")
  @Auth("admin", "cliente")
  @ApiOperation({
    summary: "Genera reporte PDF ejecutivo (4 páginas, Corporate Blue)",
  })
  @ApiBody({ type: GenerarPdfDto })
  async generarPdf(
    @Body() dto: GenerarPdfDto,
    @UsuarioActual() usuario: UsuarioSesion,
    @Res() res: Response,
  ) {
    const pdf = await this.pdfService.generarPdf(dto, usuario);
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
    @UsuarioActual() usuario: UsuarioSesion,
    @Query("cliente_id") clienteId?: string,
    @Query("gasolinera_id") gasolineraId?: string,
    @Query("fecha_desde") fechaDesde?: string,
    @Query("fecha_hasta") fechaHasta?: string,
  ) {
    return this.service.resumen(
      this.acotar(usuario, {
        cliente_id: clienteId,
        gasolinera_id: gasolineraId,
        fecha_desde: fechaDesde,
        fecha_hasta: fechaHasta,
      }),
    );
  }

  @Get("consumo-por-vehiculo")
  @Auth("admin", "cliente")
  @ApiOperation({ summary: "Ranking de vehículos por galones consumidos" })
  @ApiQuery({ name: "cliente_id", required: false })
  @ApiQuery({ name: "gasolinera_id", required: false })
  @ApiQuery({ name: "fecha_desde", required: false })
  @ApiQuery({ name: "fecha_hasta", required: false })
  consumoPorVehiculo(
    @UsuarioActual() usuario: UsuarioSesion,
    @Query("cliente_id") clienteId?: string,
    @Query("gasolinera_id") gasolineraId?: string,
    @Query("fecha_desde") fechaDesde?: string,
    @Query("fecha_hasta") fechaHasta?: string,
  ) {
    return this.service.consumoPorVehiculo(
      this.acotar(usuario, {
        cliente_id: clienteId,
        gasolinera_id: gasolineraId,
        fecha_desde: fechaDesde,
        fecha_hasta: fechaHasta,
      }),
    );
  }

  @Get("consumo-por-piloto")
  @Auth("admin", "cliente")
  @ApiOperation({ summary: "Ranking de pilotos por galones consumidos" })
  @ApiQuery({ name: "cliente_id", required: false })
  @ApiQuery({ name: "gasolinera_id", required: false })
  @ApiQuery({ name: "fecha_desde", required: false })
  @ApiQuery({ name: "fecha_hasta", required: false })
  consumoPorPiloto(
    @UsuarioActual() usuario: UsuarioSesion,
    @Query("cliente_id") clienteId?: string,
    @Query("gasolinera_id") gasolineraId?: string,
    @Query("fecha_desde") fechaDesde?: string,
    @Query("fecha_hasta") fechaHasta?: string,
  ) {
    return this.service.consumoPorPiloto(
      this.acotar(usuario, {
        cliente_id: clienteId,
        gasolinera_id: gasolineraId,
        fecha_desde: fechaDesde,
        fecha_hasta: fechaHasta,
      }),
    );
  }

  @Get("tendencia-mensual")
  @Auth("admin", "cliente")
  @ApiOperation({
    summary: "Consumo agrupado por mes (el rango pedido; sin él, 12 meses)",
  })
  @ApiQuery({ name: "cliente_id", required: false })
  @ApiQuery({ name: "gasolinera_id", required: false })
  @ApiQuery({ name: "fecha_desde", required: false })
  @ApiQuery({ name: "fecha_hasta", required: false })
  tendenciaMensual(
    @UsuarioActual() usuario: UsuarioSesion,
    @Query("cliente_id") clienteId?: string,
    @Query("gasolinera_id") gasolineraId?: string,
    @Query("fecha_desde") fechaDesde?: string,
    @Query("fecha_hasta") fechaHasta?: string,
  ) {
    return this.service.tendenciaMensual(
      this.acotar(usuario, {
        cliente_id: clienteId,
        gasolinera_id: gasolineraId,
        fecha_desde: fechaDesde,
        fecha_hasta: fechaHasta,
      }),
    );
  }

  @Get("rendimiento-vehiculo/:vehiculoId")
  @Auth("admin", "cliente")
  @ApiOperation({
    summary: "Historial de km/galón por despacho para un vehículo",
  })
  rendimientoVehiculo(
    @Param("vehiculoId") vehiculoId: string,
    @UsuarioActual() usuario: UsuarioSesion,
  ) {
    return this.service.rendimientoVehiculo(vehiculoId, usuario);
  }
}
