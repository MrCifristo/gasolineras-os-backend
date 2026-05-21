import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Auth } from '../../auth/roles.decorator';
import { PilotosService } from './pilotos.service';
import { CreatePilotoDto } from './dto/create-piloto.dto';
import { UpdatePilotoDto } from './dto/update-piloto.dto';

@Controller('pilotos')
export class PilotosController {
  constructor(private readonly service: PilotosService) {}

  @Get()
  @Auth('admin', 'operario', 'cliente')
  findAll(@Query('cliente_id') clienteId?: string) {
    return this.service.findAll(clienteId);
  }

  @Get(':id')
  @Auth('admin', 'operario', 'cliente')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @Auth('admin')
  create(@Body() dto: CreatePilotoDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @Auth('admin')
  update(@Param('id') id: string, @Body() dto: UpdatePilotoDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @Auth('admin')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
