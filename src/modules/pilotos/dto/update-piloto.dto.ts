import { PartialType } from "@nestjs/swagger";
import { CreatePilotoDto } from "./create-piloto.dto";

export class UpdatePilotoDto extends PartialType(CreatePilotoDto) {}
