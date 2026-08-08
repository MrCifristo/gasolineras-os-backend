import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsString,
  IsNotEmpty,
  IsUUID,
  IsOptional,
  Matches,
  MaxLength,
} from "class-validator";

export class CreateOperarioDto {
  @ApiProperty({ example: "uuid-de-la-gasolinera" })
  @IsUUID()
  gasolinera_id: string;

  @ApiProperty({ example: "María López" })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  nombre: string;

  @ApiPropertyOptional({ example: "OP-001" })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  @Matches(/^[A-Za-z0-9-]+$/)
  codigo?: string;
}
