import { Type } from "class-transformer";
import {
  IsDateString,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from "class-validator";

export class FiltrosReporteDto {
  @IsOptional() @IsUUID() cliente_id?: string;
  @IsOptional() @IsUUID() gasolinera_id?: string;
  @IsOptional() @IsDateString() fecha_desde?: string;
  @IsOptional() @IsDateString() fecha_hasta?: string;
}

export class GraficasDto {
  @IsOptional() @IsString() donut?: string;
  @IsOptional() @IsString() linea?: string;
  @IsOptional() @IsString() vehiculos?: string;
  @IsOptional() @IsString() pilotos?: string;
}

export class GenerarPdfDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => FiltrosReporteDto)
  filtros?: FiltrosReporteDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => GraficasDto)
  graficas?: GraficasDto;
}
