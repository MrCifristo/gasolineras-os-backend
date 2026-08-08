import { ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from "class-validator";

export class UpdateUsuarioDto {
  @ApiPropertyOptional({ example: "nuevo@email.com" })
  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  email?: string;

  @ApiPropertyOptional({ example: "+502 5555-1234" })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  @Matches(/^[0-9+()\-\s]{6,30}$/, {
    message: "El teléfono tiene un formato inválido",
  })
  telefono?: string;

  @ApiPropertyOptional({ example: "Juan Pérez Actualizado" })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  nombre?: string;

  @ApiPropertyOptional({
    enum: ["admin", "supervisor", "cliente", "jefe_pista"],
  })
  @IsOptional()
  @IsEnum(["admin", "supervisor", "cliente", "jefe_pista"])
  rol?: "admin" | "supervisor" | "cliente" | "jefe_pista";

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
