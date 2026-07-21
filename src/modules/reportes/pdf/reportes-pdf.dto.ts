import { applyDecorators } from "@nestjs/common";
import { Type } from "class-transformer";
import {
  IsDateString,
  IsOptional,
  IsUUID,
  Matches,
  MaxLength,
  ValidateNested,
} from "class-validator";

export class FiltrosReporteDto {
  @IsOptional() @IsUUID() cliente_id?: string;
  @IsOptional() @IsUUID() gasolinera_id?: string;
  @IsOptional() @IsDateString() fecha_desde?: string;
  @IsOptional() @IsDateString() fecha_hasta?: string;
}

// Las gráficas las manda el frontend como dataURL y terminan interpoladas
// dentro de src="..." en el HTML que renderiza Puppeteer. Un @IsString() acepta
// comillas y permite romper el atributo, así que acá se exige la forma exacta.
const DATA_URL_IMAGEN = /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/;

function IsImagenDataUrl() {
  return applyDecorators(
    MaxLength(1_000_000),
    Matches(DATA_URL_IMAGEN, {
      message: "$property debe ser un data URL de imagen png o jpeg en base64",
    }),
  );
}

export class GraficasDto {
  @IsOptional() @IsImagenDataUrl() donut?: string;
  @IsOptional() @IsImagenDataUrl() linea?: string;
  @IsOptional() @IsImagenDataUrl() vehiculos?: string;
  @IsOptional() @IsImagenDataUrl() pilotos?: string;
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
