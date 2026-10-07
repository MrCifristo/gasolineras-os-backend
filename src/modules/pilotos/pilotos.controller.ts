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

type ReqConUsuario = {
  user: { rol: string; cliente_id?: string | null };
};

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
  @Auth("admin", "cliente")
  @ApiOperation({
    summary: "Crear piloto (el cliente, a nombre de su empresa)",
  })
  create(@Body() dto: CreatePilotoDto, @Request() req: ReqConUsuario) {
    return this.service.create(dto, req.user);
  }

  @Patch(":id")
  @Auth("admin", "cliente")
  @ApiOperation({ summary: "Editar piloto (el cliente, sólo los suyos)" })
  update(
    @Param("id") id: string,
    @Body() dto: UpdatePilotoDto,
    @Request() req: ReqConUsuario,
  ) {
    return this.service.update(id, dto, req.user);
  }

  @Delete(":id")
  @Auth("admin", "cliente")
  @ApiOperation({
    summary: "Desactivar piloto (soft delete; el cliente, sólo los suyos)",
  })
  remove(@Param("id") id: string, @Request() req: ReqConUsuario) {
    return this.service.remove(id, req.user);
  }
}
