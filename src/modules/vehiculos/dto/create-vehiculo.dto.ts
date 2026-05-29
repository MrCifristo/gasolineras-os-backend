import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsString,
  IsNotEmpty,
  IsUUID,
  IsOptional,
  IsBoolean,
  IsNumber,
  IsInt,
  IsArray,
  IsIn,
  Matches,
  Min,
} from "class-validator";

export class CreateVehiculoDto {
  @ApiProperty({ example: "uuid-del-cliente" })
  @IsUUID()
  cliente_id: string;

  @ApiProperty({ example: "P-123ABC" })
  @IsString()
  @IsNotEmpty()
  placa: string;

  @ApiPropertyOptional({ example: "Toyota" })
  @IsOptional()
  @IsString()
  marca?: string;

  @ApiPropertyOptional({ example: "Hilux 2022" })
  @IsOptional()
  @IsString()
  modelo?: string;

  @ApiPropertyOptional({ example: "Ruta 1 - Ciudad" })
  @IsOptional()
  @IsString()
  ruta?: string;

  @ApiPropertyOptional({ example: "Camión" })
  @IsOptional()
  @IsString()
  tipo_vehiculo?: string;

  @ApiPropertyOptional({ example: false, description: "Bloquear el vehículo — no puede despachar si true" })
  @IsOptional()
  @IsBoolean()
  bloqueado?: boolean;

  @IsOptional() @IsNumber() @Min(0)
  limite_monto_transaccion?: number | null;
  @IsOptional() @IsNumber() @Min(0)
  limite_monto_dia?: number | null;
  @IsOptional() @IsNumber() @Min(0)
  limite_monto_semana?: number | null;
  @IsOptional() @IsNumber() @Min(0)
  limite_monto_mes?: number | null;
  @IsOptional() @IsNumber() @Min(0)
  limite_volumen_transaccion?: number | null;
  @IsOptional() @IsNumber() @Min(0)
  limite_volumen_dia?: number | null;
  @IsOptional() @IsNumber() @Min(0)
  limite_volumen_semana?: number | null;
  @IsOptional() @IsNumber() @Min(0)
  limite_volumen_mes?: number | null;
  @IsOptional() @IsInt() @Min(0)
  limite_trans_dia?: number | null;
  @IsOptional() @IsInt() @Min(0)
  limite_trans_semana?: number | null;
  @IsOptional() @IsInt() @Min(0)
  limite_trans_mes?: number | null;
  @IsOptional() @IsArray()
  @IsIn(["diesel", "super", "regular", "gas_lp"], { each: true })
  productos_permitidos?: string[] | null;

  @ApiPropertyOptional({
    example: ["lunes", "martes", "miercoles", "jueves", "viernes"],
    description: "Días permitidos para despachar. null = todos los días",
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  dias_permitidos?: string[] | null;

  @ApiPropertyOptional({ example: "07:00", description: "Hora de inicio del horario autorizado (Guatemala UTC-6)" })
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: "hora_inicio debe tener formato HH:mm" })
  hora_inicio?: string | null;

  @ApiPropertyOptional({ example: "17:00", description: "Hora de fin del horario autorizado (Guatemala UTC-6)" })
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: "hora_fin debe tener formato HH:mm" })
  hora_fin?: string | null;
}
