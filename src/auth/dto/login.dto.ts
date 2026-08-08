import { ApiProperty } from "@nestjs/swagger";
import { IsString, IsNotEmpty, MaxLength, MinLength } from "class-validator";

export class LoginDto {
  @ApiProperty({
    example: "admin@gasolinera.com",
    description: "Correo o número de teléfono del usuario",
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(254)
  identificador: string;

  @ApiProperty({ example: "Contraseña123!" })
  @IsString()
  @MinLength(8)
  password: string;
}
