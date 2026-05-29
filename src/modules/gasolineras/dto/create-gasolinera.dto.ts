import { ApiProperty } from "@nestjs/swagger";
import { IsString, IsNotEmpty } from "class-validator";

export class CreateGasolineraDto {
  @ApiProperty({ example: "Gasolinera Central" })
  @IsString()
  @IsNotEmpty()
  nombre: string;

  @ApiProperty({ example: "5a Avenida 12-34 Zona 1" })
  @IsString()
  @IsNotEmpty()
  direccion: string;

  @ApiProperty({ example: "Ciudad de Guatemala" })
  @IsString()
  @IsNotEmpty()
  ciudad: string;
}
