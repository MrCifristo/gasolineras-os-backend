import { IsString, IsNotEmpty, IsUUID, IsOptional } from 'class-validator';

export class CreatePilotoDto {
  @IsUUID()
  cliente_id: string;

  @IsString()
  @IsNotEmpty()
  nombre_completo: string;

  @IsOptional()
  @IsString()
  codigo?: string;
}
