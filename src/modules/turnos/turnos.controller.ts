// src/modules/turnos/turnos.controller.ts
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
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
import { TurnosService } from "./turnos.service";
import { UpdateTurnoDto } from "./dto/update-turno.dto";

@ApiTags("turnos")
@ApiBearerAuth("JWT")
@Controller()
export class TurnosController {
  constructor(private readonly service: TurnosService) {}

  @Get("gasolineras/:id/turnos")
  @Auth("admin", "supervisor", "jefe_pista")
  @ApiOperation({ summary: "Horario de los dos turnos de una gasolinera" })
  listar(@Param("id", ParseUUIDPipe) id: string) {
    return this.service.listar(id);
  }

  @Patch("gasolineras/:id/turnos/:turno")
  @Auth("admin")
  @ApiOperation({ summary: "Editar horario o recordatorio de un turno" })
  actualizar(
    @Param("id", ParseUUIDPipe) id: string,
    @Param("turno") turno: string,
    @Body() dto: UpdateTurnoDto,
  ) {
    return this.service.actualizar(id, turno, dto);
  }

  @Get("turnos/actual")
  @Auth("admin", "supervisor")
  @ApiOperation({ summary: "Turno vigente según la hora de Guatemala" })
  @ApiQuery({ name: "gasolinera_id", required: false })
  actual(@Request() req: any, @Query("gasolinera_id") gasolineraId?: string) {
    // El supervisor sólo opera su gasolinera: el query se ignora.
    const id =
      req.user.rol === "supervisor" ? req.user.gasolinera_id : gasolineraId;
    if (!id) throw new BadRequestException("Falta gasolinera_id");
    return this.service.turnoActual(id);
  }
}
