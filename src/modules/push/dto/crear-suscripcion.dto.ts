import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  IsDefined,
  IsNotEmpty,
  IsString,
  IsUrl,
  MaxLength,
  ValidateNested,
} from "class-validator";

class ClavesSuscripcionDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(255) p256dh: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(255) auth: string;
}

/** Forma de PushSubscription.toJSON() en el navegador (sin expirationTime). */
export class CrearSuscripcionDto {
  @ApiProperty({ example: "https://fcm.googleapis.com/fcm/send/…" })
  @IsUrl({ protocols: ["https"], require_tld: true })
  @MaxLength(2048)
  endpoint: string;

  @ApiProperty({ type: ClavesSuscripcionDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => ClavesSuscripcionDto)
  keys: ClavesSuscripcionDto;
}
