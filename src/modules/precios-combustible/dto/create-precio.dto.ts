import { ApiProperty } from "@nestjs/swagger";
import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsNumberString,
  IsUUID,
} from "class-validator";

export enum TipoCombustible {
  DIESEL = "diesel",
  SUPER = "super",
  REGULAR = "regular",
  GAS_LP = "gas_lp",
}

export class CreatePrecioDto {
  @ApiProperty({ example: "uuid-de-la-gasolinera" })
  @IsUUID()
  gasolinera_id: string;

  @ApiProperty({ example: "2026-05-21" })
  @IsDateString()
  fecha: string;

  @ApiProperty({ enum: TipoCombustible, example: TipoCombustible.DIESEL })
  @IsEnum(TipoCombustible)
  tipo_combustible: TipoCombustible;

  @ApiProperty({ example: "32.500" })
  @IsNumberString()
  @IsNotEmpty()
  precio_galon: string;
}
