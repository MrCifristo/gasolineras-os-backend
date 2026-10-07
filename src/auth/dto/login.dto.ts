import { ApiProperty } from "@nestjs/swagger";
import { IsString, IsNotEmpty, MaxLength, MinLength } from "class-validator";

export class LoginDto {
  @ApiProperty({
    example: "admin@gasolinera.com",
    description: "Correo o número de teléfono del usuario",
  })
  @IsString({ message: "Ingrese su correo o teléfono" })
  @IsNotEmpty({ message: "Ingrese su correo o teléfono" })
  @MaxLength(254, { message: "El correo o teléfono es demasiado largo" })
  identificador: string;

  @ApiProperty({ example: "Contraseña123!" })
  @IsString({ message: "Ingrese su contraseña" })
  @MinLength(8, { message: "La contraseña debe tener al menos 8 caracteres" })
  password: string;
}
