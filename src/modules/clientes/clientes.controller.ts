import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Auth } from "../../auth/roles.decorator";
import { ClientesService } from "./clientes.service";
import { CreateClienteDto } from "./dto/create-cliente.dto";
import { UpdateClienteDto } from "./dto/update-cliente.dto";

@ApiTags("clientes")
@ApiBearerAuth("JWT")
@Controller("clientes")
export class ClientesController {
  constructor(private readonly service: ClientesService) {}

  @Get()
  @Auth("admin", "supervisor", "cliente")
  @ApiOperation({ summary: "Listar clientes activos" })
  findAll() {
    return this.service.findAll();
  }

  @Get(":id")
  @Auth("admin", "supervisor", "cliente")
  @ApiOperation({ summary: "Obtener cliente con sus vehículos y pilotos" })
  findOne(@Param("id") id: string) {
    return this.service.findOne(id);
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

  @Delete(":id")
  @Auth("admin")
  @ApiOperation({ summary: "Desactivar cliente (soft delete)" })
  remove(@Param("id") id: string) {
    return this.service.remove(id);
  }
}
