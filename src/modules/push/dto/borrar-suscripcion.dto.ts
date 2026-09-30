import { ApiProperty } from "@nestjs/swagger";
import { IsString, IsNotEmpty, MaxLength } from "class-validator";

export class BorrarSuscripcionDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(2048) endpoint: string;
}
