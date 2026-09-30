// src/modules/turnos/dto/update-turno.dto.ts
import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsBoolean, IsOptional, Matches } from "class-validator";

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export class UpdateTurnoDto {
  @ApiPropertyOptional({ example: "06:00" })
  @IsOptional()
  @Matches(HHMM, { message: "hora_inicio debe tener formato HH:mm (24 h)" })
  hora_inicio?: string;

  @ApiPropertyOptional({ example: "14:00" })
  @IsOptional()
  @Matches(HHMM, { message: "hora_fin debe tener formato HH:mm (24 h)" })
  hora_fin?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  recordatorio_activo?: boolean;
}
