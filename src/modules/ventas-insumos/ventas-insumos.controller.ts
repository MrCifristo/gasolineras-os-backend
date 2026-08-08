import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Request,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Auth } from "../../auth/roles.decorator";
import { CreateVentaInsumoDto } from "./dto/create-venta-insumo.dto";
import {
  VentasInsumosService,
  type FiltrosVenta,
} from "./ventas-insumos.service";

@ApiTags("ventas-insumos")
@ApiBearerAuth("JWT")
@Controller("ventas-insumos")
export class VentasInsumosController {
  constructor(private readonly service: VentasInsumosService) {}

  @Get()
  @Auth("admin", "supervisor", "cliente")
  @ApiOperation({ summary: "Listar ventas de insumos (con scoping por rol)" })
  findAll(@Query() query: FiltrosVenta, @Request() req: any) {
    return this.service.findAll(query, req.user);
  }

  @Get(":id")
  @Auth("admin", "supervisor", "cliente")
  @ApiOperation({ summary: "Venta con sus renglones" })
  findOne(@Param("id") id: string, @Request() req: any) {
    return this.service.findOne(id, req.user);
  }

  @Post()
  @Auth("admin", "supervisor")
  @ApiOperation({
    summary:
      "Registrar venta. En efectivo no toca el saldo; a cargo del cliente lo debita.",
  })
  create(@Body() dto: CreateVentaInsumoDto, @Request() req: any) {
    return this.service.create(dto, req.user);
  }
}
