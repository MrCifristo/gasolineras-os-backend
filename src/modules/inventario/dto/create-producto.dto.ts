import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from "class-validator";

export class CreateProductoDto {
  @ApiProperty({ example: "Aceite 15W-40 galón" })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  nombre: string;

  @ApiPropertyOptional({ example: "ACE-15W40-GL" })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  sku?: string;

  @ApiProperty({ example: 185.5 })
  @IsNumber()
  @Min(0)
  precio: number;

  @ApiPropertyOptional({
    example: 24,
    description:
      "Existencia inicial. Deja su movimiento de entrada en el kardex.",
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  stock_actual?: number;

  @ApiPropertyOptional({ example: 5, description: "Umbral de stock bajo" })
  @IsOptional()
  @IsInt()
  @Min(0)
  stock_minimo?: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}
