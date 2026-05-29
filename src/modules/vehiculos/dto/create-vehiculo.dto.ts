import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsString, IsNotEmpty, IsUUID, IsOptional } from "class-validator";

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
}
