import { ApiProperty } from "@nestjs/swagger";
import { IsString, MaxLength, MinLength } from "class-validator";

export class SolicitarResetDto {
  // Correo o teléfono, igual que el login. No se valida como email: el usuario
  // puede identificarse con cualquiera de los dos.
  @ApiProperty({ example: "supervisor@gasolinera.com" })
  @IsString()
  @MinLength(3)
  @MaxLength(254)
  identificador: string;
}
