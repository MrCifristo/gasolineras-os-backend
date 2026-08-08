import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";

export enum TipoCombustible {
  DIESEL = "diesel",
  SUPER = "super",
  REGULAR = "regular",
  GAS_LP = "gas_lp",
}

export enum Turno {
  MANANA = "manana",
  TARDE = "tarde",
}

export enum Renglon {
  VEHICULO = "vehiculo",
  CANECA = "caneca",
  TONEL = "tonel",
}

export class DespachoDetalleDto {
  @ApiProperty({ enum: Renglon, example: Renglon.VEHICULO })
  @IsEnum(Renglon)
  renglon: Renglon;

  @ApiProperty({ enum: TipoCombustible, example: TipoCombustible.DIESEL })
  @IsEnum(TipoCombustible)
  tipo_combustible: TipoCombustible;

  @ApiProperty({
    example: "1552.05",
    description: "Monto en quetzales de este renglón; los galones se derivan",
  })
  @IsNumberString()
  monto: string;
}

export class CreateDespachoDto {
  @ApiProperty({ example: "uuid-del-cliente" })
  @IsUUID()
  cliente_id: string;

  // Opcionales desde el vale multi-renglón: puede haber un despacho sólo a
  // canecas o toneles. Si viene uno, tiene que venir el otro.
  @ApiPropertyOptional({ example: "uuid-del-vehiculo" })
  @IsOptional()
  @IsUUID()
  vehiculo_id?: string;

  @ApiPropertyOptional({ example: "uuid-del-piloto" })
  @IsOptional()
  @IsUUID()
  piloto_id?: string;

  @ApiProperty({
    example: "uuid-del-operario",
    description: "Operario que físicamente despacha, elegido del listado",
  })
  @IsUUID()
  operario_id: string;

  @ApiProperty({ enum: Turno, example: Turno.MANANA })
  @IsEnum(Turno)
  turno: Turno;

  /**
   * Forma nueva: un renglón por destino (vehículo, caneca, tonel), cada uno con
   * su combustible y su monto. El vale unifica el total.
   *
   * Se acepta también la forma vieja de un solo renglón (`tipo_combustible` +
   * `monto` en la raíz), que el servicio normaliza a un único renglón
   * `vehiculo`. Mandar las dos formas a la vez es un 400.
   */
  @ApiPropertyOptional({ type: [DespachoDetalleDto] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => DespachoDetalleDto)
  detalles?: DespachoDetalleDto[];

  @ApiPropertyOptional({
    enum: TipoCombustible,
    example: TipoCombustible.DIESEL,
    description: "Forma de un solo renglón. En lo nuevo, usar `detalles`.",
  })
  @IsOptional()
  @IsEnum(TipoCombustible)
  tipo_combustible?: TipoCombustible;

  @ApiPropertyOptional({ example: 2 })
  @IsOptional()
  @IsInt()
  @Min(1)
  bomba_numero?: number;

  @ApiPropertyOptional({ example: "125000.500" })
  @IsOptional()
  @IsNumberString()
  kilometraje?: string;

  @ApiPropertyOptional({
    example: "1552.05",
    description:
      "Forma de un solo renglón: monto en quetzales. En lo nuevo, usar `detalles`.",
  })
  @IsOptional()
  @IsNumberString()
  monto?: string;

  @ApiPropertyOptional({ example: "data:image/png;base64,iVBORw0KGgo..." })
  @IsOptional()
  @IsString()
  @MaxLength(200000)
  firma_piloto_base64?: string;
}
