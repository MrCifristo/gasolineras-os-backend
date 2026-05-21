import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Auth } from '../../auth/roles.decorator';
import { VehiculosService } from './vehiculos.service';
import { CreateVehiculoDto } from './dto/create-vehiculo.dto';
import { UpdateVehiculoDto } from './dto/update-vehiculo.dto';

@Controller('vehiculos')
export class VehiculosController {
  constructor(private readonly service: VehiculosService) {}

  @Get()
  @Auth('admin', 'operario', 'cliente')
  findAll(@Query('cliente_id') clienteId?: string, @Query('activo') activo?: string) {
    return this.service.findAll(clienteId, activo !== undefined ? activo === 'true' : undefined);
  }

  @Get(':id')
  @Auth('admin', 'operario', 'cliente')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @Auth('admin')
  create(@Body() dto: CreateVehiculoDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @Auth('admin')
  update(@Param('id') id: string, @Body() dto: UpdateVehiculoDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @Auth('admin')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }

  @Post(':id/pilotos/:pilotoId')
  @Auth('admin')
  asignarPiloto(@Param('id') id: string, @Param('pilotoId') pilotoId: string) {
    return this.service.asignarPiloto(id, pilotoId);
  }

  @Delete(':id/pilotos/:pilotoId')
  @Auth('admin')
  desasignarPiloto(@Param('id') id: string, @Param('pilotoId') pilotoId: string) {
    return this.service.desasignarPiloto(id, pilotoId);
  }
}
