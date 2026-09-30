import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { DbModule } from "./db/db.module";
import { AuthModule } from "./auth/auth.module";
import { StorageModule } from "./storage/storage.module";
import { MailModule } from "./mail/mail.module";
import { PushModule } from "./push/push.module";
import { GasolinerasModule } from "./modules/gasolineras/gasolineras.module";
import { ClientesModule } from "./modules/clientes/clientes.module";
import { VehiculosModule } from "./modules/vehiculos/vehiculos.module";
import { PilotosModule } from "./modules/pilotos/pilotos.module";
import { OperariosModule } from "./modules/operarios/operarios.module";
import { PreciosCombustibleModule } from "./modules/precios-combustible/precios-combustible.module";
import { DespachosModule } from "./modules/despachos/despachos.module";
import { ReportesModule } from "./modules/reportes/reportes.module";
import { UsuariosModule } from "./modules/usuarios/usuarios.module";
import { SaldosModule } from "./modules/saldos/saldos.module";
import { ConfiguracionSistemaModule } from "./modules/configuracion-sistema/configuracion-sistema.module";
import { InventarioModule } from "./modules/inventario/inventario.module";
import { VentasInsumosModule } from "./modules/ventas-insumos/ventas-insumos.module";
import { TurnosModule } from "./modules/turnos/turnos.module";
import { PushSuscripcionesModule } from "./modules/push/push-suscripciones.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DbModule,
    AuthModule,
    StorageModule,
    MailModule,
    PushModule,
    GasolinerasModule,
    ClientesModule,
    VehiculosModule,
    PilotosModule,
    OperariosModule,
    PreciosCombustibleModule,
    DespachosModule,
    ReportesModule,
    UsuariosModule,
    SaldosModule,
    ConfiguracionSistemaModule,
    InventarioModule,
    VentasInsumosModule,
    TurnosModule,
    PushSuscripcionesModule,
  ],
})
export class AppModule {}
