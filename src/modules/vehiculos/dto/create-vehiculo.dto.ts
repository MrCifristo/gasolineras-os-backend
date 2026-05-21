import { IsString, IsNotEmpty, IsUUID, IsOptional } from 'class-validator';

export class CreateVehiculoDto {
  @IsUUID()
  cliente_id: string;

  @IsString()
  @IsNotEmpty()
  placa: string;

  @IsOptional()
  @IsString()
  marca?: string;

  @IsOptional()
  @IsString()
  modelo?: string;

  @IsOptional()
  @IsString()
  ruta?: string;

  @IsOptional()
  @IsString()
  tipo_vehiculo?: string;
}
