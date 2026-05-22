import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
} from "class-validator";

export class CreateAbonoDto {
  @ApiProperty({ example: "550e8400-e29b-41d4-a716-446655440000" })
  @IsUUID()
  cliente_id: string;

  @ApiProperty({ example: "550e8400-e29b-41d4-a716-446655440001" })
  @IsUUID()
  gasolinera_id: string;

  @ApiProperty({
    example: "1500.000",
    description: "Monto en quetzales, mayor a cero",
  })
  @IsNumberString()
  monto: string;

  @ApiPropertyOptional({ example: "Pago transferencia bancaria" })
  @IsOptional()
  @IsString()
  descripcion?: string;
}
