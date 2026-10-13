import { ApiProperty } from "@nestjs/swagger";
import { IsNotEmpty, IsString, MaxLength } from "class-validator";

/** Alta y edición llevan lo mismo: sólo el nombre. */
export class TipoVehiculoDto {
  @ApiProperty({ example: "Motocicleta" })
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  nombre: string;
}
