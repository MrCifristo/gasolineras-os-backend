import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from "class-validator";

export enum TipoMovimientoInventario {
  ENTRADA = "entrada",
  SALIDA = "salida",
}

export class AjustarStockDto {
  @ApiProperty({ enum: TipoMovimientoInventario })
  @IsEnum(TipoMovimientoInventario)
  tipo: TipoMovimientoInventario;

  @ApiProperty({
    example: 12,
    description: "Siempre positiva; el signo lo pone `tipo`",
  })
  @IsInt()
  @Min(1)
  cantidad: number;

  @ApiPropertyOptional({ example: "Compra a proveedor" })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  motivo?: string;

  @ApiPropertyOptional({ example: "FAC-00123" })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  referencia?: string;
}
