import { PartialType } from '@nestjs/mapped-types';
import { CreatePilotoDto } from './create-piloto.dto';

export class UpdatePilotoDto extends PartialType(CreatePilotoDto) {}
