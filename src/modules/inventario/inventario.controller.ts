import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Auth } from "../../auth/roles.decorator";
import { AjustarStockDto } from "./dto/ajustar-stock.dto";
import { CreateProductoDto } from "./dto/create-producto.dto";
import { UpdateProductoDto } from "./dto/update-producto.dto";
import { InventarioService } from "./inventario.service";

@ApiTags("inventario")
@ApiBearerAuth("JWT")
@Controller("inventario")
export class InventarioController {
  constructor(private readonly service: InventarioService) {}

  // El supervisor necesita leer el catálogo para vender en la bomba; sólo el
  // admin lo modifica.
  @Get("productos")
  @Auth("admin", "supervisor")
  @ApiOperation({ summary: "Listar productos activos" })
  findAll(@Query("stock_bajo") stockBajo?: string) {
    return this.service.findAll(stockBajo === "true");
  }

  @Get("productos/bajos")
  @Auth("admin", "supervisor")
  @ApiOperation({ summary: "Productos en o bajo su umbral de reposición" })
  bajos() {
    return this.service.bajos();
  }

  @Get("productos/:id")
  @Auth("admin", "supervisor")
  @ApiOperation({ summary: "Obtener producto por ID" })
  findOne(@Param("id") id: string) {
    return this.service.findOne(id);
  }

  @Get("productos/:id/movimientos")
  @Auth("admin")
  @ApiOperation({ summary: "Kardex del producto (últimos 100 movimientos)" })
  movimientos(@Param("id") id: string) {
    return this.service.movimientos(id);
  }

  @Post("productos")
  @Auth("admin")
  @ApiOperation({ summary: "Crear producto" })
  create(@Body() dto: CreateProductoDto) {
    return this.service.create(dto);
  }

  @Patch("productos/:id")
  @Auth("admin")
  @ApiOperation({
    summary: "Actualizar producto (el stock no; usar /stock para moverlo)",
  })
  update(@Param("id") id: string, @Body() dto: UpdateProductoDto) {
    return this.service.update(id, dto);
  }

  @Post("productos/:id/stock")
  @Auth("admin", "supervisor")
  @ApiOperation({
    summary: "Entrada o salida de stock; deja rastro en el kardex",
  })
  ajustarStock(@Param("id") id: string, @Body() dto: AjustarStockDto) {
    return this.service.ajustarStock(id, dto);
  }

  @Delete("productos/:id")
  @Auth("admin")
  @ApiOperation({ summary: "Desactivar producto (baja lógica)" })
  remove(@Param("id") id: string) {
    return this.service.remove(id);
  }
}
