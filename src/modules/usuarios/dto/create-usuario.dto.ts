import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from "class-validator";

export class CreateUsuarioDto {
  @ApiProperty({ example: "operario@gasolinera.com" })
  @IsEmail()
  @MaxLength(254)
  email: string;

  @ApiProperty({ example: "Juan Pérez" })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  nombre: string;

  @ApiProperty({ enum: ["admin", "operario", "cliente"], example: "operario" })
  @IsEnum(["admin", "operario", "cliente"])
  rol: "admin" | "operario" | "cliente";

  @ApiProperty({
    example: "Contraseña123!",
    description: "Contraseña temporal para el nuevo usuario",
  })
  @IsString()
  @MinLength(8)
  password: string;

  @ApiPropertyOptional({ example: "uuid-de-gasolinera" })
  @IsOptional()
  @IsString()
  gasolinera_id?: string;

  @ApiPropertyOptional({ example: "uuid-de-cliente" })
  @IsOptional()
  @IsString()
  cliente_id?: string;
}
