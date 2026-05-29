import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsEmail, IsOptional, IsString, IsNotEmpty } from "class-validator";

export class CreateClienteDto {
  @ApiProperty({ example: "Coca-Cola Guatemala" })
  @IsString()
  @IsNotEmpty()
  nombre: string;

  @ApiPropertyOptional({ example: "1234567-8" })
  @IsOptional()
  @IsString()
  nit?: string;

  @ApiPropertyOptional({ example: "contacto@cocacola.com" })
  @IsOptional()
  @IsEmail()
  contacto_email?: string;
}
