import { Injectable } from "@nestjs/common";
import { MailService, type MensajeCorreo } from "./mail.service";

/**
 * Fake en memoria de MailService para los tests: sin red, sin Resend, sin
 * cuota. Guarda lo enviado para poder afirmar sobre el contenido — en el
 * ciclo de reset, el token sólo existe dentro del correo.
 */
@Injectable()
export class InMemoryMailService extends MailService {
  readonly enviados: MensajeCorreo[] = [];

  enviar(mensaje: MensajeCorreo): Promise<void> {
    this.enviados.push({ ...mensaje });
    return Promise.resolve();
  }

  /** Último correo dirigido a un destinatario, que es lo que suele afirmarse. */
  ultimoPara(para: string): MensajeCorreo | undefined {
    return [...this.enviados]
      .reverse()
      .find((m) => m.para.toLowerCase() === para.toLowerCase());
  }

  limpiar(): void {
    this.enviados.length = 0;
  }
}
