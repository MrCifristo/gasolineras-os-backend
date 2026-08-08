import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsDateString, IsOptional } from "class-validator";

export class QueryEstadoCuentaDto {
  @ApiPropertyOptional({
    example: "2026-08-01",
    description:
      "Inicio del período. Todo lo anterior se resume en el saldo inicial.",
  })
  @IsOptional()
  @IsDateString()
  fecha_desde?: string;

  @ApiPropertyOptional({
    example: "2026-08-31",
    description: "Fin del período",
  })
  @IsOptional()
  @IsDateString()
  fecha_hasta?: string;
}
