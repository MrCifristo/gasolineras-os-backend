import { Global, Module } from "@nestjs/common";
import { PushService } from "./push.service";
import { WebPushService } from "./web-push.service";

/** Global como MailModule: los recordatorios inyectan PushService sin importarlo. */
@Global()
@Module({
  providers: [{ provide: PushService, useClass: WebPushService }],
  exports: [PushService],
})
export class PushModule {}
