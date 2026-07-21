import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
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

export class CreateDespachoDto {
  @ApiProperty({ example: "uuid-del-cliente" })
  @IsUUID()
  cliente_id: string;

  @ApiProperty({ example: "uuid-del-vehiculo" })
  @IsUUID()
  vehiculo_id: string;

  @ApiProperty({ example: "uuid-del-piloto" })
  @IsUUID()
  piloto_id: string;

  @ApiProperty({ enum: Turno, example: Turno.MANANA })
  @IsEnum(Turno)
  turno: Turno;

  @ApiProperty({ enum: TipoCombustible, example: TipoCombustible.DIESEL })
  @IsEnum(TipoCombustible)
  tipo_combustible: TipoCombustible;

  @ApiPropertyOptional({ example: 2 })
  @IsOptional()
  @IsInt()
  @Min(1)
  bomba_numero?: number;

  @ApiPropertyOptional({ example: "125000.500" })
  @IsOptional()
  @IsNumberString()
  kilometraje?: string;

  @ApiProperty({
    example: "1552.05",
    description: "Monto en quetzales; los galones se derivan del precio",
  })
  @IsNumberString()
  monto: string;

  @ApiPropertyOptional({ example: "data:image/png;base64,iVBORw0KGgo..." })
  @IsOptional()
  @IsString()
  @MaxLength(200000)
  firma_piloto_base64?: string;
}
