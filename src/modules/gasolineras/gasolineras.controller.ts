import { Body, Controller, Delete, Get, Param, Patch, Post, Request } from '@nestjs/common';
import { Auth } from '../../auth/roles.decorator';
import { GasolinerasService } from './gasolineras.service';
import { CreateGasolineraDto } from './dto/create-gasolinera.dto';
import { UpdateGasolineraDto } from './dto/update-gasolinera.dto';

@Controller('gasolineras')
export class GasolinerasController {
  constructor(private readonly service: GasolinerasService) {}

  @Get()
  @Auth('admin', 'operario')
  findAll(@Request() req: any) {
    if (req.user.rol === 'operario' && req.user.gasolinera_id) {
      return this.service.findOne(req.user.gasolinera_id);
    }
    return this.service.findAll();
  }

  @Get(':id')
  @Auth('admin', 'operario')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @Auth('admin')
  create(@Body() dto: CreateGasolineraDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @Auth('admin')
  update(@Param('id') id: string, @Body() dto: UpdateGasolineraDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @Auth('admin')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
