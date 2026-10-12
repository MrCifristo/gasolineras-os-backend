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
import { PilotosService } from "./pilotos.service";
import { CreatePilotoDto } from "./dto/create-piloto.dto";
import { UpdatePilotoDto } from "./dto/update-piloto.dto";
import { UsuarioActual, type UsuarioSesion } from "../../auth/usuario-actual";

@ApiTags("pilotos")
@ApiBearerAuth("JWT")
@Controller("pilotos")
export class PilotosController {
  constructor(private readonly service: PilotosService) {}

  @Get()
  @Auth("admin", "supervisor", "cliente")
  @ApiOperation({ summary: "Listar pilotos, filtrable por cliente_id" })
  @ApiQuery({ name: "cliente_id", required: false })
  findAll(
    @UsuarioActual() usuario: UsuarioSesion,
    @Query("cliente_id") clienteId?: string,
  ) {
    return this.service.findAll(clienteId, usuario);
  }

  @Get(":id")
  @Auth("admin", "supervisor", "cliente")
  @ApiOperation({ summary: "Obtener piloto con sus vehículos asignados" })
  findOne(@Param("id") id: string, @UsuarioActual() usuario: UsuarioSesion) {
    return this.service.findOne(id, usuario);
  }

  @Post()
  @Auth("admin", "cliente")
  @ApiOperation({
    summary: "Crear piloto (el cliente, a nombre de su empresa)",
  })
  create(
    @Body() dto: CreatePilotoDto,
    @UsuarioActual() usuario: UsuarioSesion,
  ) {
    return this.service.create(dto, usuario);
  }

  @Patch(":id")
  @Auth("admin", "cliente")
  @ApiOperation({ summary: "Editar piloto (el cliente, sólo los suyos)" })
  update(
    @Param("id") id: string,
    @Body() dto: UpdatePilotoDto,
    @UsuarioActual() usuario: UsuarioSesion,
  ) {
    return this.service.update(id, dto, usuario);
  }

  @Delete(":id")
  @Auth("admin", "cliente")
  @ApiOperation({
    summary: "Desactivar piloto (soft delete; el cliente, sólo los suyos)",
  })
  remove(@Param("id") id: string, @UsuarioActual() usuario: UsuarioSesion) {
    return this.service.remove(id, usuario);
  }
}
