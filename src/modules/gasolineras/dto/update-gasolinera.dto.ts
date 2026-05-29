import { PartialType } from "@nestjs/swagger";
import { CreateGasolineraDto } from "./create-gasolinera.dto";

export class UpdateGasolineraDto extends PartialType(CreateGasolineraDto) {}
