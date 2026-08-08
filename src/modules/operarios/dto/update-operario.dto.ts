import { PartialType } from "@nestjs/swagger";
import { CreateOperarioDto } from "./create-operario.dto";

export class UpdateOperarioDto extends PartialType(CreateOperarioDto) {}
