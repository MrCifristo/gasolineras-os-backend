/**
 * Envío de correo transaccional. Se define como interfaz, igual que
 * StorageService, para poder inyectar un fake en memoria en los tests sin
 * pegarle a Resend ni depender de la red.
 */
export interface MensajeCorreo {
  para: string;
  asunto: string;
  html: string;
  /** Alternativa en texto plano. Sin ella, varios clientes marcan spam. */
  texto?: string;
}

export abstract class MailService {
  abstract enviar(mensaje: MensajeCorreo): Promise<void>;
}
