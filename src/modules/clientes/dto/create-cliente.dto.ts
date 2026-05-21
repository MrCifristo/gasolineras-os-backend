import { IsEmail, IsOptional, IsString, IsNotEmpty } from 'class-validator';

export class CreateClienteDto {
  @IsString()
  @IsNotEmpty()
  nombre: string;

  @IsOptional()
  @IsString()
  nit?: string;

  @IsOptional()
  @IsEmail()
  contacto_email?: string;
}
