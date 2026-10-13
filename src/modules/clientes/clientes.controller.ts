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
import { ClientesService } from "./clientes.service";
import { CreateClienteDto } from "./dto/create-cliente.dto";
import { UpdateClienteDto } from "./dto/update-cliente.dto";
import { UsuarioActual, type UsuarioSesion } from "../../auth/usuario-actual";

@ApiTags("clientes")
@ApiBearerAuth("JWT")
@Controller("clientes")
export class ClientesController {
  constructor(private readonly service: ClientesService) {}

  @Get()
  @Auth("admin", "supervisor", "cliente")
  @ApiOperation({ summary: "Listar clientes activos" })
  findAll(@UsuarioActual() usuario: UsuarioSesion) {
    return this.service.findAll(usuario);
  }

  // Antes de `:id`, o Nest lo tomaría como un id.
  @Get("inactivos")
  @Auth("admin")
  @ApiOperation({ summary: "Listar clientes desactivados" })
  findInactivos() {
    return this.service.findInactivos();
  }

  @Get(":id")
  @Auth("admin", "supervisor", "cliente")
  @ApiOperation({ summary: "Obtener cliente con sus vehículos y pilotos" })
  findOne(@Param("id") id: string, @UsuarioActual() usuario: UsuarioSesion) {
    return this.service.findOne(id, usuario);
  }

  @Post()
  @Auth("admin")
  @ApiOperation({ summary: "Crear cliente" })
  create(@Body() dto: CreateClienteDto) {
    return this.service.create(dto);
  }

  @Patch(":id")
  @Auth("admin")
  @ApiOperation({ summary: "Editar cliente" })
  update(@Param("id") id: string, @Body() dto: UpdateClienteDto) {
    return this.service.update(id, dto);
  }

  @Patch(":id/reactivar")
  @Auth("admin")
  @ApiOperation({ summary: "Reactivar un cliente desactivado" })
  reactivar(@Param("id", ParseUUIDPipe) id: string) {
    return this.service.reactivar(id);
  }

  @Delete(":id")
  @Auth("admin")
  @ApiOperation({ summary: "Desactivar cliente (soft delete)" })
  remove(@Param("id") id: string) {
    return this.service.remove(id);
  }
}
