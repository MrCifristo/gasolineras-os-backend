import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsBoolean,
  IsEmail,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from "class-validator";

export class CreateClienteDto {
  @ApiProperty({ example: "Coca-Cola Guatemala" })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  nombre: string;

  @ApiPropertyOptional({ example: "1234567-8" })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  @Matches(/^[A-Za-z0-9-]+$/)
  nit?: string;

  @ApiPropertyOptional({ example: "contacto@cocacola.com" })
  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  contacto_email?: string;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  bloqueado?: boolean;

  @ApiPropertyOptional({
    example: false,
    description:
      "Corta sólo el consumo a crédito. Distinto de `bloqueado`, que suspende la cuenta entera.",
  })
  @IsOptional()
  @IsBoolean()
  credito_bloqueado?: boolean;

  @ApiPropertyOptional({
    example: 5000,
    description:
      "Saldo de apertura. No es una columna: genera un movimiento de crédito sin gasolinera.",
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  saldo_inicial?: number;

  // Límites de cuenta
  @ApiPropertyOptional({ example: 5000 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  limite_monto_dia?: number;

  @ApiPropertyOptional({ example: 30000 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  limite_monto_semana?: number;

  @ApiPropertyOptional({ example: 100000 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  limite_monto_mes?: number;

  // Plantilla para vehículos nuevos
  @ApiPropertyOptional({ example: 2000 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  plantilla_monto_transaccion?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  plantilla_monto_dia?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  plantilla_monto_semana?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  plantilla_monto_mes?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  plantilla_volumen_transaccion?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  plantilla_volumen_dia?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  plantilla_volumen_semana?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  plantilla_volumen_mes?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  plantilla_trans_dia?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  plantilla_trans_semana?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  plantilla_trans_mes?: number;

  @ApiPropertyOptional({ example: ["diesel"] })
  @IsOptional()
  @IsString({ each: true })
  plantilla_productos_permitidos?: string[];
}
