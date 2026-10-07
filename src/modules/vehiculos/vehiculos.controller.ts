import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Request,
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
import { UpdateRestriccionesVehiculoDto } from "./dto/update-restricciones-vehiculo.dto";

type ReqConUsuario = {
  user: { rol: string; cliente_id?: string | null };
};

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
    @Request() req?: any,
  ) {
    return this.service.findAll(
      clienteId,
      activo !== undefined ? activo === "true" : undefined,
      req?.user,
    );
  }

  @Get(":id")
  @Auth("admin", "supervisor", "cliente")
  @ApiOperation({ summary: "Obtener vehículo por ID" })
  findOne(@Param("id") id: string, @Request() req: any) {
    return this.service.findOne(id, req.user);
  }

  @Post()
  @Auth("admin", "cliente")
  @ApiOperation({
    summary: "Crear vehículo (el cliente, a nombre de su empresa)",
  })
  create(@Body() dto: CreateVehiculoDto, @Request() req: ReqConUsuario) {
    return this.service.create(dto, req.user);
  }

  @Patch(":id")
  @Auth("admin", "cliente")
  @ApiOperation({ summary: "Editar vehículo (el cliente, sólo los suyos)" })
  update(
    @Param("id") id: string,
    @Body() dto: UpdateVehiculoDto,
    @Request() req: ReqConUsuario,
  ) {
    return this.service.update(id, dto, req.user);
  }

  @Patch(":id/restricciones")
  @Auth("admin", "cliente")
  @ApiOperation({
    summary:
      "Editar sólo las restricciones del vehículo (el cliente, únicamente en los suyos)",
  })
  updateRestricciones(
    @Param("id") id: string,
    @Body() dto: UpdateRestriccionesVehiculoDto,
    @Request() req: any,
  ) {
    return this.service.updateRestricciones(id, dto, req.user);
  }

  @Delete(":id")
  @Auth("admin", "cliente")
  @ApiOperation({
    summary: "Desactivar vehículo (soft delete; el cliente, sólo los suyos)",
  })
  remove(@Param("id") id: string, @Request() req: ReqConUsuario) {
    return this.service.remove(id, req.user);
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
