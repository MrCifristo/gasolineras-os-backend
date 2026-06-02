import { ApiProperty } from "@nestjs/swagger";
import { IsBoolean } from "class-validator";

export class UpdateConfiguracionDto {
  @ApiProperty({ example: false })
  @IsBoolean()
  sistema_bloqueado: boolean;
}
