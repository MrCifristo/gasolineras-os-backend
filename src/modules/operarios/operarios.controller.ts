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
import { OperariosService } from "./operarios.service";
import { CreateOperarioDto } from "./dto/create-operario.dto";
import { UpdateOperarioDto } from "./dto/update-operario.dto";

@ApiTags("operarios")
@ApiBearerAuth("JWT")
@Controller("operarios")
export class OperariosController {
  constructor(private readonly service: OperariosService) {}

  @Get()
  @Auth("admin", "supervisor")
  @ApiOperation({
    summary:
      "Listar operarios activos. El supervisor ve los de su gasolinera; el admin, todos (filtrable por gasolinera_id).",
  })
  @ApiQuery({ name: "gasolinera_id", required: false })
  findAll(@Request() req: any, @Query("gasolinera_id") gasolineraId?: string) {
    // El supervisor queda acotado a su propia gasolinera; el admin puede filtrar.
    if (req.user.rol === "supervisor") {
      return this.service.findAll(req.user.gasolinera_id ?? undefined);
    }
    return this.service.findAll(gasolineraId);
  }

  @Get(":id")
  @Auth("admin", "supervisor")
  @ApiOperation({ summary: "Obtener operario" })
  findOne(@Param("id") id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @Auth("admin")
  @ApiOperation({ summary: "Crear operario" })
  create(@Body() dto: CreateOperarioDto) {
    return this.service.create(dto);
  }

  @Patch(":id")
  @Auth("admin")
  @ApiOperation({ summary: "Editar operario" })
  update(@Param("id") id: string, @Body() dto: UpdateOperarioDto) {
    return this.service.update(id, dto);
  }

  @Delete(":id")
  @Auth("admin")
  @ApiOperation({ summary: "Desactivar operario (soft delete)" })
  remove(@Param("id") id: string) {
    return this.service.remove(id);
  }
}
