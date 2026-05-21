import { PartialType } from '@nestjs/mapped-types';
import { CreatePrecioDto } from './create-precio.dto';

export class UpdatePrecioDto extends PartialType(CreatePrecioDto) {}
