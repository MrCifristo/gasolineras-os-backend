import { ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MinLength,
} from "class-validator";

export class UpdateUsuarioDto {
  @ApiPropertyOptional({ example: "nuevo@email.com" })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ example: "Juan Pérez Actualizado" })
  @IsOptional()
  @IsString()
  nombre?: string;

  @ApiPropertyOptional({ enum: ["admin", "operario", "cliente"] })
  @IsOptional()
  @IsEnum(["admin", "operario", "cliente"])
  rol?: "admin" | "operario" | "cliente";

  @ApiPropertyOptional({ example: "NuevaContraseña123!" })
  @IsOptional()
  @IsString()
  @MinLength(8)
  password?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  gasolinera_id?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  cliente_id?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}
