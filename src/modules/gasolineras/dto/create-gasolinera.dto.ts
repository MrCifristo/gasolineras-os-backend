import { IsString, IsNotEmpty } from 'class-validator';

export class CreateGasolineraDto {
  @IsString()
  @IsNotEmpty()
  nombre: string;

  @IsString()
  @IsNotEmpty()
  direccion: string;

  @IsString()
  @IsNotEmpty()
  ciudad: string;
}
