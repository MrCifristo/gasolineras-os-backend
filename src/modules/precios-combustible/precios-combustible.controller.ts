import { Body, Controller, Get, Param, Patch, Post, Query, Request } from '@nestjs/common';
import { Auth } from '../../auth/roles.decorator';
import { PreciosCombustibleService } from './precios-combustible.service';
import { CreatePrecioDto } from './dto/create-precio.dto';
import { UpdatePrecioDto } from './dto/update-precio.dto';

@Controller('precios-combustible')
export class PreciosCombustibleController {
  constructor(private readonly service: PreciosCombustibleService) {}

  @Get()
  @Auth('admin', 'operario')
  findAll(@Query('gasolinera_id') gasolineraId?: string, @Query('fecha') fecha?: string) {
    return this.service.findAll(gasolineraId, fecha);
  }

  @Get('hoy')
  @Auth('admin', 'operario')
  findHoy(@Request() req: any) {
    return this.service.findHoy(req.user.gasolinera_id);
  }

  @Post()
  @Auth('admin')
  create(@Body() dto: CreatePrecioDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @Auth('admin')
  update(@Param('id') id: string, @Body() dto: UpdatePrecioDto) {
    return this.service.update(id, dto);
  }
}
