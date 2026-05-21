import { Controller, Get, Param, Query } from '@nestjs/common';
import { Auth } from '../../auth/roles.decorator';
import { ReportesService } from './reportes.service';

@Controller('reportes')
export class ReportesController {
  constructor(private readonly service: ReportesService) {}

  @Get('resumen')
  @Auth('admin', 'cliente')
  resumen(
    @Query('cliente_id') clienteId?: string,
    @Query('gasolinera_id') gasolineraId?: string,
    @Query('fecha_desde') fechaDesde?: string,
    @Query('fecha_hasta') fechaHasta?: string,
  ) {
    return this.service.resumen({
      cliente_id: clienteId,
      gasolinera_id: gasolineraId,
      fecha_desde: fechaDesde,
      fecha_hasta: fechaHasta,
    });
  }

  @Get('consumo-por-vehiculo')
  @Auth('admin', 'cliente')
  consumoPorVehiculo(
    @Query('cliente_id') clienteId?: string,
    @Query('gasolinera_id') gasolineraId?: string,
    @Query('fecha_desde') fechaDesde?: string,
    @Query('fecha_hasta') fechaHasta?: string,
  ) {
    return this.service.consumoPorVehiculo({
      cliente_id: clienteId,
      gasolinera_id: gasolineraId,
      fecha_desde: fechaDesde,
      fecha_hasta: fechaHasta,
    });
  }

  @Get('consumo-por-piloto')
  @Auth('admin', 'cliente')
  consumoPorPiloto(
    @Query('cliente_id') clienteId?: string,
    @Query('gasolinera_id') gasolineraId?: string,
    @Query('fecha_desde') fechaDesde?: string,
    @Query('fecha_hasta') fechaHasta?: string,
  ) {
    return this.service.consumoPorPiloto({
      cliente_id: clienteId,
      gasolinera_id: gasolineraId,
      fecha_desde: fechaDesde,
      fecha_hasta: fechaHasta,
    });
  }

  @Get('tendencia-mensual')
  @Auth('admin', 'cliente')
  tendenciaMensual(
    @Query('cliente_id') clienteId?: string,
    @Query('gasolinera_id') gasolineraId?: string,
  ) {
    return this.service.tendenciaMensual({
      cliente_id: clienteId,
      gasolinera_id: gasolineraId,
    });
  }

  @Get('rendimiento-vehiculo/:vehiculoId')
  @Auth('admin', 'cliente')
  rendimientoVehiculo(@Param('vehiculoId') vehiculoId: string) {
    return this.service.rendimientoVehiculo(vehiculoId);
  }
}
