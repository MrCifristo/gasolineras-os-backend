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
import { PilotosService } from "./pilotos.service";
import { CreatePilotoDto } from "./dto/create-piloto.dto";
import { UpdatePilotoDto } from "./dto/update-piloto.dto";

@ApiTags("pilotos")
@ApiBearerAuth("JWT")
@Controller("pilotos")
export class PilotosController {
  constructor(private readonly service: PilotosService) {}

  @Get()
  @Auth("admin", "supervisor", "cliente")
  @ApiOperation({ summary: "Listar pilotos, filtrable por cliente_id" })
  @ApiQuery({ name: "cliente_id", required: false })
  findAll(@Query("cliente_id") clienteId?: string, @Request() req?: any) {
    return this.service.findAll(clienteId, req?.user);
  }

  @Get(":id")
  @Auth("admin", "supervisor", "cliente")
  @ApiOperation({ summary: "Obtener piloto con sus vehículos asignados" })
  findOne(@Param("id") id: string, @Request() req: any) {
    return this.service.findOne(id, req.user);
  }

  @Post()
  @Auth("admin")
  @ApiOperation({ summary: "Crear piloto" })
  create(@Body() dto: CreatePilotoDto) {
    return this.service.create(dto);
  }

  @Patch(":id")
  @Auth("admin")
  @ApiOperation({ summary: "Editar piloto" })
  update(@Param("id") id: string, @Body() dto: UpdatePilotoDto) {
    return this.service.update(id, dto);
  }

  @Delete(":id")
  @Auth("admin")
  @ApiOperation({ summary: "Desactivar piloto (soft delete)" })
  remove(@Param("id") id: string) {
    return this.service.remove(id);
  }
}
