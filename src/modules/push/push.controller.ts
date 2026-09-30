import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Post,
  Request,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Auth } from "../../auth/roles.decorator";
import { PushService } from "../../push/push.service";
import { SuscripcionesPushService } from "./suscripciones-push.service";
import { CrearSuscripcionDto } from "./dto/crear-suscripcion.dto";
import { BorrarSuscripcionDto } from "./dto/borrar-suscripcion.dto";

@ApiTags("push")
@Controller("push")
export class PushController {
  constructor(
    private readonly push: PushService,
    private readonly service: SuscripcionesPushService,
  ) {}

  // Pública a propósito: la clave VAPID pública no es un secreto.
  @Get("vapid-public-key")
  @ApiOperation({
    summary: "Clave pública VAPID (null si el push está desactivado)",
  })
  clave() {
    return { key: this.push.clavePublica() };
  }

  @Post("suscripciones")
  @ApiBearerAuth("JWT")
  @Auth("admin", "jefe_pista")
  @ApiOperation({ summary: "Registrar la suscripción push de este navegador" })
  guardar(@Request() req: any, @Body() dto: CrearSuscripcionDto) {
    return this.service.guardar(req.user.id, dto, req.headers["user-agent"]);
  }

  @Delete("suscripciones")
  @HttpCode(200)
  @ApiBearerAuth("JWT")
  @Auth("admin", "jefe_pista")
  @ApiOperation({ summary: "Eliminar la suscripción push de este navegador" })
  borrar(@Request() req: any, @Body() dto: BorrarSuscripcionDto) {
    return this.service.borrar(req.user.id, dto.endpoint);
  }
}
