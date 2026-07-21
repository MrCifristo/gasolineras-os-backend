import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsString,
  IsNotEmpty,
  IsUUID,
  IsOptional,
  Matches,
  MaxLength,
} from "class-validator";

export class CreatePilotoDto {
  @ApiProperty({ example: "uuid-del-cliente" })
  @IsUUID()
  cliente_id: string;

  @ApiProperty({ example: "Juan Carlos Pérez" })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  nombre_completo: string;

  @ApiPropertyOptional({ example: "PIL-001" })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  @Matches(/^[A-Za-z0-9-]+$/)
  codigo?: string;
}
