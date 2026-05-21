import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DbModule } from './db/db.module';
import { AuthModule } from './auth/auth.module';
import { GasolinerasModule } from './modules/gasolineras/gasolineras.module';
import { ClientesModule } from './modules/clientes/clientes.module';
import { VehiculosModule } from './modules/vehiculos/vehiculos.module';
import { PilotosModule } from './modules/pilotos/pilotos.module';
import { PreciosCombustibleModule } from './modules/precios-combustible/precios-combustible.module';
import { DespachosModule } from './modules/despachos/despachos.module';
import { ReportesModule } from './modules/reportes/reportes.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DbModule,
    AuthModule,
    GasolinerasModule,
    ClientesModule,
    VehiculosModule,
    PilotosModule,
    PreciosCombustibleModule,
    DespachosModule,
    ReportesModule,
  ],
})
export class AppModule {}
