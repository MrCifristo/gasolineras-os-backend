import { IsDateString, IsEnum, IsNotEmpty, IsNumberString, IsUUID } from 'class-validator';

export enum TipoCombustible {
  DIESEL = 'diesel',
  SUPER = 'super',
  REGULAR = 'regular',
  GAS_LP = 'gas_lp',
}

export class CreatePrecioDto {
  @IsUUID()
  gasolinera_id: string;

  @IsDateString()
  fecha: string;

  @IsEnum(TipoCombustible)
  tipo_combustible: TipoCombustible;

  @IsNumberString()
  @IsNotEmpty()
  precio_galon: string;
}
