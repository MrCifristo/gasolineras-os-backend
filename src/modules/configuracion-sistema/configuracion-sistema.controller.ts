import { Body, Controller, Get, Patch, Request } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Auth } from "../../auth/roles.decorator";
import { ConfiguracionSistemaService } from "./configuracion-sistema.service";
import { UpdateConfiguracionDto } from "./dto/update-configuracion.dto";
import { UsuarioActual, type UsuarioSesion } from "../../auth/usuario-actual";

@ApiTags("configuracion-sistema")
@ApiBearerAuth("JWT")
@Controller("configuracion-sistema")
export class ConfiguracionSistemaController {
  constructor(private readonly service: ConfiguracionSistemaService) {}

  @Get()
  @Auth("admin", "supervisor")
  @ApiOperation({ summary: "Leer estado del sistema (bloqueado/activo)" })
  findOne() {
    return this.service.findOne();
  }

  @Patch()
  @Auth("admin")
  @ApiOperation({
    summary: "Activar/desactivar paro de emergencia global (solo admin)",
  })
  update(
    @Body() dto: UpdateConfiguracionDto,
    @UsuarioActual() usuario: UsuarioSesion,
  ) {
    // Un admin puede no tener correo (alta sólo con teléfono): sin este
    // respaldo, bloqueado_por quedaba en null y no se sabía quién paró.
    return this.service.update(
      dto,
      usuario.email ?? usuario.telefono ?? usuario.nombre,
    );
  }
}
