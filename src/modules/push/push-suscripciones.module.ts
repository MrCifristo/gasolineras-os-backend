import { Module } from "@nestjs/common";
import { PushController } from "./push.controller";
import { SuscripcionesPushService } from "./suscripciones-push.service";

@Module({
  controllers: [PushController],
  providers: [SuscripcionesPushService],
  exports: [SuscripcionesPushService],
})
export class PushSuscripcionesModule {}
