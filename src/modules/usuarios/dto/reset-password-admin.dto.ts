import { ApiProperty } from "@nestjs/swagger";
import { IsEnum } from "class-validator";

export const MODOS_RESET = ["generar", "enlace"] as const;
export type ModoReset = (typeof MODOS_RESET)[number];

export class ResetPasswordAdminDto {
  @ApiProperty({
    enum: MODOS_RESET,
    description:
      '"generar" devuelve una contraseña temporal en la respuesta; "enlace" manda un correo de recuperación y no devuelve nada.',
  })
  @IsEnum(MODOS_RESET)
  modo: ModoReset;
}
