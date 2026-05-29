import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsString, IsNotEmpty, IsUUID, IsOptional } from "class-validator";

export class CreatePilotoDto {
  @ApiProperty({ example: "uuid-del-cliente" })
  @IsUUID()
  cliente_id: string;

  @ApiProperty({ example: "Juan Carlos Pérez" })
  @IsString()
  @IsNotEmpty()
  nombre_completo: string;

  @ApiPropertyOptional({ example: "PIL-001" })
  @IsOptional()
  @IsString()
  codigo?: string;
}
