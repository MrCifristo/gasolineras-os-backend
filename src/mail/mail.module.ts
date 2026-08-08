import { Global, Module } from "@nestjs/common";
import { MailService } from "./mail.service";
import { ResendMailService } from "./resend-mail.service";

/**
 * Global por la misma razón que StorageModule: auth y usuarios inyectan
 * MailService sin importar el módulo. El token es la clase abstracta, así que
 * los tests lo sustituyen con el fake en memoria vía overrideProvider.
 */
@Global()
@Module({
  providers: [{ provide: MailService, useClass: ResendMailService }],
  exports: [MailService],
})
export class MailModule {}
