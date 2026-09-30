import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Request,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Auth } from "../../auth/roles.decorator";
import { GasolinerasService } from "./gasolineras.service";
import { CreateGasolineraDto } from "./dto/create-gasolinera.dto";
import { UpdateGasolineraDto } from "./dto/update-gasolinera.dto";

@ApiTags("gasolineras")
@ApiBearerAuth("JWT")
@Controller("gasolineras")
export class GasolinerasController {
  constructor(private readonly service: GasolinerasService) {}

  @Get()
  @Auth("admin", "supervisor", "jefe_pista")
  @ApiOperation({
    summary: "Listar gasolineras (admin: todas, operario: la propia)",
  })
  findAll(@Request() req: any) {
    if (req.user.rol === "supervisor" && req.user.gasolinera_id) {
      return this.service.findOne(req.user.gasolinera_id);
    }
    return this.service.findAll();
  }

  @Get(":id")
  @Auth("admin", "supervisor", "jefe_pista")
  @ApiOperation({ summary: "Obtener gasolinera por ID" })
  findOne(@Param("id") id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @Auth("admin")
  @ApiOperation({ summary: "Crear gasolinera" })
  create(@Body() dto: CreateGasolineraDto) {
    return this.service.create(dto);
  }

  @Patch(":id")
  @Auth("admin")
  @ApiOperation({ summary: "Editar gasolinera" })
  update(@Param("id") id: string, @Body() dto: UpdateGasolineraDto) {
    return this.service.update(id, dto);
  }

  @Delete(":id")
  @Auth("admin")
  @ApiOperation({ summary: "Desactivar gasolinera (soft delete)" })
  remove(@Param("id") id: string) {
    return this.service.remove(id);
  }
}
