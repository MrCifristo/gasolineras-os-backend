import { ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsNumberString,
  IsOptional,
  IsString,
  MaxLength,
} from "class-validator";

export class UpdateDespachoDto {
  @ApiPropertyOptional({ example: "125500.000" })
  @IsOptional()
  @IsNumberString()
  kilometraje?: string;

  @ApiPropertyOptional({ example: "data:image/png;base64,iVBORw0KGgo..." })
  @IsOptional()
  @IsString()
  @MaxLength(200000)
  firma_piloto_base64?: string;
}
