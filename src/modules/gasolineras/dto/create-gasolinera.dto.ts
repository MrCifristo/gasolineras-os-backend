import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from "class-validator";

export class CreateGasolineraDto {
  @ApiProperty({ example: "Gasolinera Central" })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  nombre: string;

  @ApiProperty({ example: "5a Avenida 12-34 Zona 1" })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  direccion: string;

  @ApiProperty({ example: "Ciudad de Guatemala" })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  ciudad: string;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  bloqueado?: boolean;
}
