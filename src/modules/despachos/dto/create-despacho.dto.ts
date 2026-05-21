import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';

export enum TipoCombustible {
  DIESEL = 'diesel',
  SUPER = 'super',
  REGULAR = 'regular',
  GAS_LP = 'gas_lp',
}

export enum Turno {
  MANANA = 'manana',
  TARDE = 'tarde',
}

export class CreateDespachoDto {
  @IsUUID()
  cliente_id: string;

  @IsUUID()
  vehiculo_id: string;

  @IsUUID()
  piloto_id: string;

  @IsString()
  @IsNotEmpty()
  serie_vale: string;

  @IsEnum(Turno)
  turno: Turno;

  @IsEnum(TipoCombustible)
  tipo_combustible: TipoCombustible;

  @IsOptional()
  @IsInt()
  @Min(1)
  bomba_numero?: number;

  @IsOptional()
  @IsNumberString()
  kilometraje?: string;

  @IsNumberString()
  galones: string;

  @IsOptional()
  @IsString()
  firma_piloto_base64?: string;
}
