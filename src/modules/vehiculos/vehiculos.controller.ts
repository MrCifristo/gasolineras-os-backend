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
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from "@nestjs/swagger";
import { Auth } from "../../auth/roles.decorator";
import { VehiculosService } from "./vehiculos.service";
import { CreateVehiculoDto } from "./dto/create-vehiculo.dto";
import { UpdateVehiculoDto } from "./dto/update-vehiculo.dto";

@ApiTags("vehiculos")
@ApiBearerAuth("JWT")
@Controller("vehiculos")
export class VehiculosController {
  constructor(private readonly service: VehiculosService) {}

  @Get()
  @Auth("admin", "supervisor", "cliente")
  @ApiOperation({
    summary: "Listar vehículos, filtrable por cliente_id y activo",
  })
  @ApiQuery({ name: "cliente_id", required: false })
  @ApiQuery({ name: "activo", required: false, type: Boolean })
  findAll(
    @Query("cliente_id") clienteId?: string,
    @Query("activo") activo?: string,
  ) {
    return this.service.findAll(
      clienteId,
      activo !== undefined ? activo === "true" : undefined,
    );
  }

  @Get(":id")
  @Auth("admin", "supervisor", "cliente")
  @ApiOperation({ summary: "Obtener vehículo por ID" })
  findOne(@Param("id") id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @Auth("admin")
  @ApiOperation({ summary: "Crear vehículo" })
  create(@Body() dto: CreateVehiculoDto) {
    return this.service.create(dto);
  }

  @Patch(":id")
  @Auth("admin")
  @ApiOperation({ summary: "Editar vehículo" })
  update(@Param("id") id: string, @Body() dto: UpdateVehiculoDto) {
    return this.service.update(id, dto);
  }

  @Delete(":id")
  @Auth("admin")
  @ApiOperation({ summary: "Desactivar vehículo (soft delete)" })
  remove(@Param("id") id: string) {
    return this.service.remove(id);
  }

  @Post(":id/pilotos/:pilotoId")
  @Auth("admin")
  @ApiOperation({ summary: "Asignar piloto a vehículo" })
  asignarPiloto(@Param("id") id: string, @Param("pilotoId") pilotoId: string) {
    return this.service.asignarPiloto(id, pilotoId);
  }

  @Delete(":id/pilotos/:pilotoId")
  @Auth("admin")
  @ApiOperation({ summary: "Desasignar piloto de vehículo" })
  desasignarPiloto(
    @Param("id") id: string,
    @Param("pilotoId") pilotoId: string,
  ) {
    return this.service.desasignarPiloto(id, pilotoId);
  }
}
