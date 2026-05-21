import { PartialType } from '@nestjs/mapped-types';
import { CreateGasolineraDto } from './create-gasolinera.dto';

export class UpdateGasolineraDto extends PartialType(CreateGasolineraDto) {}
