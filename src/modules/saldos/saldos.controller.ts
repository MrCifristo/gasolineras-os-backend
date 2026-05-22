import { Body, Controller, Get, Param, Post, Query, Request } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth } from '../../auth/roles.decorator';
import { CreateAbonoDto } from './dto/create-abono.dto';
import { CreateCuadreDto } from './dto/create-cuadre.dto';
import { QueryCuadresDto } from './dto/query-cuadres.dto';
import { QueryMovimientosDto } from './dto/query-movimientos.dto';
import { SaldosService } from './saldos.service';

@ApiTags('saldos')
@ApiBearerAuth('JWT')
@Controller('saldos')
export class SaldosController {
  constructor(private readonly service: SaldosService) {}

  @Get('cliente/:id')
  @Auth('admin')
  @ApiOperation({ summary: 'Saldo actual + últimos 20 movimientos del cliente' })
  getClienteSaldo(@Param('id') id: string) {
    return this.service.getClienteSaldo(id);
  }

  @Get('cliente/:id/movimientos')
  @Auth('admin')
  @ApiOperation({ summary: 'Historial paginado de movimientos del cliente' })
  getClienteMovimientos(@Param('id') id: string, @Query() query: QueryMovimientosDto) {
    return this.service.getClienteMovimientos(id, query);
  }

  @Post('abonos')
  @Auth('admin')
  @ApiOperation({ summary: 'Registrar abono (crédito) a un cliente' })
  createAbono(@Body() dto: CreateAbonoDto) {
    return this.service.createAbono(dto);
  }

  @Post('cuadres')
  @Auth('admin')
  @ApiOperation({ summary: 'Registrar cuadre de conciliación' })
  createCuadre(@Body() dto: CreateCuadreDto, @Request() req: any) {
    return this.service.createCuadre(dto, req.user.id);
  }

  @Get('cuadres')
  @Auth('admin')
  @ApiOperation({ summary: 'Listar cuadres con filtros opcionales' })
  findCuadres(@Query() query: QueryCuadresDto) {
    return this.service.findCuadres(query);
  }
}
