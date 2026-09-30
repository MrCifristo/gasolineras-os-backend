// src/modules/turnos/turnos.module.ts
import { Module } from "@nestjs/common";
import { PushSuscripcionesModule } from "../push/push-suscripciones.module";
import { RecordatoriosService } from "./recordatorios.service";
import { TurnosController } from "./turnos.controller";
import { TurnosService } from "./turnos.service";

@Module({
  imports: [PushSuscripcionesModule],
  controllers: [TurnosController],
  providers: [TurnosService, RecordatoriosService],
  exports: [TurnosService],
})
export class TurnosModule {}
