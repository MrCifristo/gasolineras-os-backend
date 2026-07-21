import { ApiProperty } from "@nestjs/swagger";
import { IsString, IsNotEmpty, MaxLength } from "class-validator";

export class RefreshDto {
  @ApiProperty({ description: "Refresh token opaco entregado en el login" })
  @IsString()
  @IsNotEmpty()
  // randomBytes(32) en base64url son 43 caracteres; el tope corta cualquier
  // intento de mandar un body enorme a un endpoint sin autenticar.
  @MaxLength(256)
  refresh_token: string;
}
