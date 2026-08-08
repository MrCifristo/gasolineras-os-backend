import { ApiProperty } from "@nestjs/swagger";
import { IsString, MaxLength, MinLength } from "class-validator";

export class ResetPasswordDto {
  @ApiProperty({ description: "Token recibido por correo" })
  @IsString()
  @MinLength(20)
  @MaxLength(200)
  token: string;

  @ApiProperty({ example: "Contraseña123!", minLength: 8 })
  @IsString()
  @MinLength(8)
  @MaxLength(200)
  password: string;
}
