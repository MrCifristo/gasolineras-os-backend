import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Request,
  Res,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from "@nestjs/swagger";
import type { Response } from "express";
import { Auth } from "../../auth/roles.decorator";
import { DespachosExcelService } from "./despachos-excel.service";
import { DespachosService } from "./despachos.service";
import { CreateDespachoDto } from "./dto/create-despacho.dto";
import { UpdateDespachoDto } from "./dto/update-despacho.dto";

@ApiTags("despachos")
@ApiBearerAuth("JWT")
@Controller("despachos")
export class DespachosController {
  constructor(
    private readonly service: DespachosService,
    private readonly excelService: DespachosExcelService,
  ) {}

  @Get()
  @Auth("admin", "operario", "cliente")
  @ApiOperation({ summary: "Listar despachos con filtros y paginación" })
  @ApiQuery({ name: "gasolinera_id", required: false })
  @ApiQuery({ name: "cliente_id", required: false })
  @ApiQuery({ name: "vehiculo_id", required: false })
  @ApiQuery({ name: "piloto_id", required: false })
  @ApiQuery({ name: "fecha_desde", required: false, example: "2026-01-01" })
  @ApiQuery({ name: "fecha_hasta", required: false, example: "2026-12-31" })
  @ApiQuery({ name: "turno", required: false, enum: ["manana", "tarde"] })
  @ApiQuery({
    name: "tipo_combustible",
    required: false,
    enum: ["diesel", "super", "regular", "gas_lp"],
  })
  @ApiQuery({ name: "page", required: false, type: Number })
  @ApiQuery({ name: "limit", required: false, type: Number })
  findAll(
    @Request() req: any,
    @Query("gasolinera_id") gasolineraId?: string,
    @Query("cliente_id") clienteId?: string,
    @Query("vehiculo_id") vehiculoId?: string,
    @Query("piloto_id") pilotoId?: string,
    @Query("fecha_desde") fechaDesde?: string,
    @Query("fecha_hasta") fechaHasta?: string,
    @Query("turno") turno?: string,
    @Query("tipo_combustible") tipoCombustible?: string,
    @Query("page") page?: string,
    @Query("limit") limit?: string,
  ) {
    return this.service.findAll(
      {
        gasolinera_id: gasolineraId,
        cliente_id: clienteId,
        vehiculo_id: vehiculoId,
        piloto_id: pilotoId,
        fecha_desde: fechaDesde,
        fecha_hasta: fechaHasta,
        turno,
        tipo_combustible: tipoCombustible,
        page: page ? parseInt(page) : undefined,
        limit: limit ? parseInt(limit) : undefined,
      },
      req.user,
    );
  }

  @Get("export/xlsx")
  @Auth("admin", "operario", "cliente")
  @ApiOperation({
    summary:
      "Exportar despachos a Excel (.xlsx) con los mismos filtros del listado",
  })
  @ApiQuery({ name: "gasolinera_id", required: false })
  @ApiQuery({ name: "cliente_id", required: false })
  @ApiQuery({ name: "vehiculo_id", required: false })
  @ApiQuery({ name: "piloto_id", required: false })
  @ApiQuery({ name: "fecha_desde", required: false, example: "2026-01-01" })
  @ApiQuery({ name: "fecha_hasta", required: false, example: "2026-12-31" })
  @ApiQuery({ name: "turno", required: false, enum: ["manana", "tarde"] })
  @ApiQuery({
    name: "tipo_combustible",
    required: false,
    enum: ["diesel", "super", "regular", "gas_lp"],
  })
  async exportXlsx(
    @Request() req: any,
    @Res() res: Response,
    @Query("gasolinera_id") gasolineraId?: string,
    @Query("cliente_id") clienteId?: string,
    @Query("vehiculo_id") vehiculoId?: string,
    @Query("piloto_id") pilotoId?: string,
    @Query("fecha_desde") fechaDesde?: string,
    @Query("fecha_hasta") fechaHasta?: string,
    @Query("turno") turno?: string,
    @Query("tipo_combustible") tipoCombustible?: string,
  ) {
    const buf = await this.excelService.exportXlsx(
      {
        gasolinera_id: gasolineraId,
        cliente_id: clienteId,
        vehiculo_id: vehiculoId,
        piloto_id: pilotoId,
        fecha_desde: fechaDesde,
        fecha_hasta: fechaHasta,
        turno,
        tipo_combustible: tipoCombustible,
      },
      req.user,
    );

    const fecha = new Date().toISOString().slice(0, 10);
    res.set({
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="despachos-gasfuel-${fecha}.xlsx"`,
      "Content-Length": buf.length,
    });
    res.end(buf);
  }

  @Get("vehiculo/:vehiculoId/consumo-hoy")
  @Auth("admin", "operario", "cliente")
  @ApiOperation({
    summary:
      "Estado completo de un vehículo para despacho (sistema, gasolinera, cliente, vehículo, horario)",
  })
  @ApiQuery({ name: "cliente_id", required: false })
  @ApiQuery({ name: "gasolinera_id", required: false })
  getConsumoHoy(
    @Param("vehiculoId") vehiculoId: string,
    @Query("cliente_id") clienteId?: string,
    @Query("gasolinera_id") gasolineraId?: string,
  ) {
    return this.service.getConsumoHoy(vehiculoId, clienteId, gasolineraId);
  }

  @Get(":id/firma")
  @Auth("admin", "operario", "cliente")
  @ApiOperation({
    summary: "Firma del piloto (PNG, proxy desde R2 con scoping)",
  })
  async firma(
    @Param("id") id: string,
    @Request() req: any,
    @Res() res: Response,
  ) {
    const obj = await this.service.getFirma(id, req.user);
    res.setHeader("Content-Type", obj.contentType);
    // private: es el comprobante del piloto, no debe cachearse en proxies.
    res.setHeader("Cache-Control", "private, max-age=0, no-store");
    res.send(obj.body);
  }

  @Get(":id")
  @Auth("admin", "operario", "cliente")
  @ApiOperation({ summary: "Obtener despacho completo con joins" })
  findOne(@Param("id") id: string, @Request() req: any) {
    return this.service.findOne(id, req.user);
  }

  @Post()
  @Auth("admin", "operario")
  @ApiOperation({
    summary: "Crear despacho (transacción: precio → monto → vale → saldo)",
  })
  create(@Body() dto: CreateDespachoDto, @Request() req: any) {
    return this.service.create(dto, req.user);
  }

  @Patch(":id")
  @Auth("admin")
  @ApiOperation({ summary: "Corregir kilometraje y/o firma del piloto" })
  update(@Param("id") id: string, @Body() dto: UpdateDespachoDto) {
    return this.service.update(id, dto);
  }
}
