import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Auth } from "../../auth/roles.decorator";
import { CreateVentaInsumoDto } from "./dto/create-venta-insumo.dto";
import {
  VentasInsumosService,
  type FiltrosVenta,
} from "./ventas-insumos.service";
import { UsuarioActual, type UsuarioSesion } from "../../auth/usuario-actual";

@ApiTags("ventas-insumos")
@ApiBearerAuth("JWT")
@Controller("ventas-insumos")
export class VentasInsumosController {
  constructor(private readonly service: VentasInsumosService) {}

  @Get()
  @Auth("admin", "supervisor", "cliente")
  @ApiOperation({ summary: "Listar ventas de insumos (con scoping por rol)" })
  findAll(
    @Query() query: FiltrosVenta,
    @UsuarioActual() usuario: UsuarioSesion,
  ) {
    return this.service.findAll(query, usuario);
  }

  @Get(":id")
  @Auth("admin", "supervisor", "cliente")
  @ApiOperation({ summary: "Venta con sus renglones" })
  findOne(@Param("id") id: string, @UsuarioActual() usuario: UsuarioSesion) {
    return this.service.findOne(id, usuario);
  }

  @Post()
  // El admin pasa el guard a propósito: el servicio le responde 403 con un
  // mensaje explícito ("Solo supervisores…") en vez de "Permisos insuficientes".
  @Auth("admin", "supervisor")
  @ApiOperation({
    summary:
      "Registrar venta. En efectivo no toca el saldo; a cargo del cliente lo debita.",
  })
  create(
    @Body() dto: CreateVentaInsumoDto,
    @UsuarioActual() usuario: UsuarioSesion,
  ) {
    return this.service.create(dto, usuario);
  }
}
