import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsIn, IsOptional, IsUUID } from 'class-validator';

export class QueryCuadresDto {
  @ApiPropertyOptional({ enum: ['cliente', 'gasolinera'] })
  @IsOptional()
  @IsIn(['cliente', 'gasolinera'])
  tipo?: 'cliente' | 'gasolinera';

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  cliente_id?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  gasolinera_id?: string;

  @ApiPropertyOptional({ example: '2026-05-01' })
  @IsOptional()
  @IsDateString()
  fecha_desde?: string;

  @ApiPropertyOptional({ example: '2026-05-31' })
  @IsOptional()
  @IsDateString()
  fecha_hasta?: string;
}
