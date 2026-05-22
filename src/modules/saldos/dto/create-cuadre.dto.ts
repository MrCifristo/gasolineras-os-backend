import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  ValidateIf,
} from "class-validator";

export class CreateCuadreDto {
  @ApiProperty({ enum: ["cliente", "gasolinera"] })
  @IsIn(["cliente", "gasolinera"])
  tipo: "cliente" | "gasolinera";

  @ApiProperty({ example: "550e8400-e29b-41d4-a716-446655440001" })
  @IsUUID()
  gasolinera_id: string;

  @ApiPropertyOptional({
    example: "550e8400-e29b-41d4-a716-446655440000",
    description: 'Requerido cuando tipo = "cliente"',
  })
  @IsOptional()
  @ValidateIf((o) => o.tipo === "cliente")
  @IsUUID()
  cliente_id?: string;

  @ApiProperty({ example: "2026-05-01" })
  @IsDateString()
  fecha_desde: string;

  @ApiProperty({ example: "2026-05-22" })
  @IsDateString()
  fecha_hasta: string;

  @ApiPropertyOptional({ example: "Cuadre OK, diferencia 0" })
  @IsOptional()
  @IsString()
  notas?: string;
}
