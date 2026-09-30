import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  IsDefined,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  ValidateNested,
} from "class-validator";

class ClavesSuscripcionDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(255) p256dh: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(255) auth: string;
}

/** Forma de PushSubscription.toJSON() en el navegador (expirationTime se acepta y se ignora). */
export class CrearSuscripcionDto {
  @ApiProperty({ example: "https://fcm.googleapis.com/fcm/send/…" })
  @IsUrl({ protocols: ["https"], require_protocol: true, require_tld: true })
  @MaxLength(2048)
  endpoint: string;

  @ApiProperty({ type: ClavesSuscripcionDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => ClavesSuscripcionDto)
  keys: ClavesSuscripcionDto;

  /** El navegador lo envía (normalmente null); se acepta y se ignora. */
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsNumber()
  expirationTime?: number | null;
}
