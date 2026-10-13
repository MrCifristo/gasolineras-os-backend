import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Auth } from "../../auth/roles.decorator";
import { TiposVehiculoService } from "./tipos-vehiculo.service";
import { TipoVehiculoDto } from "./dto/tipo-vehiculo.dto";

@ApiTags("tipos-vehiculo")
@ApiBearerAuth("JWT")
@Controller("tipos-vehiculo")
export class TiposVehiculoController {
  constructor(private readonly service: TiposVehiculoService) {}

  // Cualquier rol: el cliente también da de alta vehículos de su flota.
  @Get()
  @Auth()
  @ApiOperation({ summary: "Listar tipos de vehículo activos" })
  findAll() {
    return this.service.findAll();
  }

  @Post()
  @Auth("admin")
  @ApiOperation({ summary: "Crear tipo de vehículo" })
  create(@Body() dto: TipoVehiculoDto) {
    return this.service.create(dto.nombre);
  }

  @Patch(":id")
  @Auth("admin")
  @ApiOperation({
    summary:
      "Renombrar tipo de vehículo (también en los vehículos que lo usan)",
  })
  update(@Param("id", ParseUUIDPipe) id: string, @Body() dto: TipoVehiculoDto) {
    return this.service.update(id, dto.nombre);
  }

  @Delete(":id")
  @Auth("admin")
  @ApiOperation({ summary: "Desactivar tipo de vehículo (soft delete)" })
  remove(@Param("id", ParseUUIDPipe) id: string) {
    return this.service.remove(id);
  }
}
