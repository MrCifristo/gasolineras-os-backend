import { IsNumberString, IsOptional, IsString } from 'class-validator';

export class UpdateDespachoDto {
  @IsOptional()
  @IsNumberString()
  kilometraje?: string;

  @IsOptional()
  @IsString()
  firma_piloto_base64?: string;
}
