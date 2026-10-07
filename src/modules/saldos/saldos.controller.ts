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
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { Auth } from "../../auth/roles.decorator";
import { CreateAbonoDto } from "./dto/create-abono.dto";
import { CreateCuadreDto } from "./dto/create-cuadre.dto";
import { QueryCuadresDto } from "./dto/query-cuadres.dto";
import { QueryEstadoCuentaDto } from "./dto/query-estado-cuenta.dto";
import { QueryMovimientosDto } from "./dto/query-movimientos.dto";
import { SaldosPdfService } from "./pdf/saldos-pdf.service";
import { exigirMismaEmpresa } from "./saldos.reglas";
import { SaldosService } from "./saldos.service";

@ApiTags("saldos")
@ApiBearerAuth("JWT")
@Controller("saldos")
export class SaldosController {
  constructor(
    private readonly service: SaldosService,
    private readonly pdf: SaldosPdfService,
  ) {}

  @Get("cliente/:id")
  @Auth("admin", "cliente")
  @ApiOperation({
    summary: "Saldo actual + últimos 20 movimientos del cliente",
  })
  getClienteSaldo(@Param("id") id: string, @Request() req: any) {
    exigirMismaEmpresa(req.user, id, "Cliente sin saldo registrado");
    return this.service.getClienteSaldo(id);
  }

  @Get("cliente/:id/movimientos")
  @Auth("admin", "cliente")
  @ApiOperation({ summary: "Historial paginado de movimientos del cliente" })
  getClienteMovimientos(
    @Param("id") id: string,
    @Query() query: QueryMovimientosDto,
    @Request() req: any,
  ) {
    exigirMismaEmpresa(req.user, id, "Cliente sin saldo registrado");
    return this.service.getClienteMovimientos(id, query);
  }

  @Get("cliente/:id/estado-cuenta")
  @Auth("admin", "cliente")
  @ApiOperation({
    summary:
      "Estado de cuenta del período: saldo inicial, abonos, consumos y saldo final",
  })
  getEstadoCuenta(
    @Param("id") id: string,
    @Query() query: QueryEstadoCuentaDto,
    @Request() req: any,
  ) {
    exigirMismaEmpresa(req.user, id, "Cliente no encontrado");
    return this.service.getEstadoCuenta(id, query);
  }

  @Get("cliente/:id/estado-cuenta/pdf")
  @Auth("admin", "cliente")
  @ApiOperation({ summary: "Estado de cuenta del período en PDF" })
  async getEstadoCuentaPdf(
    @Param("id") id: string,
    @Query() query: QueryEstadoCuentaDto,
    @Request() req: any,
    @Res() res: Response,
  ) {
    exigirMismaEmpresa(req.user, id, "Cliente no encontrado");
    const pdf = await this.pdf.generarEstadoCuenta(id, query);
    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="estado-cuenta-${id}.pdf"`,
      "Content-Length": pdf.length,
    });
    res.end(pdf);
  }

  @Post("abonos")
  @Auth("admin")
  @ApiOperation({ summary: "Registrar abono (crédito) a un cliente" })
  createAbono(@Body() dto: CreateAbonoDto) {
    return this.service.createAbono(dto);
  }

  @Post("cuadres")
  @Auth("admin")
  @ApiOperation({ summary: "Registrar cuadre de conciliación" })
  createCuadre(@Body() dto: CreateCuadreDto, @Request() req: any) {
    return this.service.createCuadre(dto, req.user.id);
  }

  @Get("cuadres")
  @Auth("admin")
  @ApiOperation({ summary: "Listar cuadres con filtros opcionales" })
  findCuadres(@Query() query: QueryCuadresDto) {
    return this.service.findCuadres(query);
  }
}
