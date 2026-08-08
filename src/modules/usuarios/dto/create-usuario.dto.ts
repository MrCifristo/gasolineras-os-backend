import { ApiPropertyOptional, ApiProperty } from "@nestjs/swagger";
import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from "class-validator";

export class CreateUsuarioDto {
  // email o telefono: al menos uno. La regla "uno de los dos" se valida en el
  // servicio (usuarios.service.create), ya que depende de ambos campos.
  @ApiPropertyOptional({ example: "supervisor@gasolinera.com" })
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

  @ApiProperty({ example: "Juan Pérez" })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  nombre: string;

  @ApiProperty({
    enum: ["admin", "supervisor", "cliente", "jefe_pista"],
    example: "supervisor",
  })
  @IsEnum(["admin", "supervisor", "cliente", "jefe_pista"])
  rol: "admin" | "supervisor" | "cliente" | "jefe_pista";

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
