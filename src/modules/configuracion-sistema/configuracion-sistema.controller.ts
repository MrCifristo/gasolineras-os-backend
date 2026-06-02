import { Body, Controller, Get, Patch, Request } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Auth } from "../../auth/roles.decorator";
import { ConfiguracionSistemaService } from "./configuracion-sistema.service";
import { UpdateConfiguracionDto } from "./dto/update-configuracion.dto";

@ApiTags("configuracion-sistema")
@ApiBearerAuth("JWT")
@Controller("configuracion-sistema")
export class ConfiguracionSistemaController {
  constructor(private readonly service: ConfiguracionSistemaService) {}

  @Get()
  @Auth("admin", "operario")
  @ApiOperation({ summary: "Leer estado del sistema (bloqueado/activo)" })
  findOne() {
    return this.service.findOne();
  }

  @Patch()
  @Auth("admin")
  @ApiOperation({ summary: "Activar/desactivar paro de emergencia global (solo admin)" })
  update(@Body() dto: UpdateConfiguracionDto, @Request() req: any) {
    return this.service.update(dto, req.user.email);
  }
}
