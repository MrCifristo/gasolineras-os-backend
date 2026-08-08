import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsUUID,
  Min,
  ValidateNested,
} from "class-validator";

export enum FormaPago {
  EFECTIVO = "efectivo",
  CARGO_CLIENTE = "cargo_cliente",
}

/** La estación despacha insumos sólo en las bombas 1 y 3. */
export const BOMBAS_INSUMOS = [1, 3];

export class VentaInsumoDetalleDto {
  @ApiProperty({ example: "uuid-del-producto" })
  @IsUUID()
  producto_id: string;

  @ApiProperty({ example: 2 })
  @IsInt()
  @Min(1)
  cantidad: number;
}

export class CreateVentaInsumoDto {
  @ApiProperty({ enum: FormaPago, example: FormaPago.EFECTIVO })
  @IsEnum(FormaPago)
  forma_pago: FormaPago;

  @ApiPropertyOptional({
    example: "uuid-del-cliente",
    description: "Obligatorio con cargo_cliente; prohibido con efectivo.",
  })
  @IsOptional()
  @IsUUID()
  cliente_id?: string;

  @ApiPropertyOptional({ example: "uuid-del-operario" })
  @IsOptional()
  @IsUUID()
  operario_id?: string;

  @ApiPropertyOptional({
    example: 1,
    description: "Sólo 1 o 3: son las únicas bombas que despachan insumos.",
  })
  @IsOptional()
  @IsInt()
  @IsIn(BOMBAS_INSUMOS, {
    message: "Los insumos sólo se despachan en las bombas 1 y 3",
  })
  bomba_numero?: number;

  @ApiProperty({ type: [VentaInsumoDetalleDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => VentaInsumoDetalleDto)
  detalles: VentaInsumoDetalleDto[];
}
