import {
  Injectable,
  InternalServerErrorException,
  Logger,
  OnModuleInit,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { MailService, type MensajeCorreo } from "./mail.service";

const API_RESEND = "https://api.resend.com/emails";

/**
 * Implementación sobre Resend. Se habla su API REST con `fetch` en vez de
 * sumar el SDK: es un solo POST con una API key en el header, y el SDK no
 * aporta nada que compense otra dependencia.
 */
@Injectable()
export class ResendMailService extends MailService implements OnModuleInit {
  private readonly logger = new Logger("ResendMail");
  private apiKey!: string;
  private remitente!: string;

  constructor(private readonly config: ConfigService) {
    super();
  }

  onModuleInit() {
    const apiKey = this.config.get<string>("RESEND_API_KEY");
    const remitente = this.config.get<string>("MAIL_FROM");

    // Falla al arrancar, no cuando alguien pide recuperar su contraseña y se
    // queda esperando un correo que nunca sale.
    if (!apiKey || !remitente) {
      throw new Error(
        "Faltan variables de correo (RESEND_API_KEY, MAIL_FROM).",
      );
    }

    this.apiKey = apiKey;
    this.remitente = remitente;
  }

  async enviar(mensaje: MensajeCorreo): Promise<void> {
    let respuesta: Response;
    try {
      respuesta = await fetch(API_RESEND, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: this.remitente,
          to: [mensaje.para],
          subject: mensaje.asunto,
          html: mensaje.html,
          text: mensaje.texto,
        }),
      });
    } catch (e) {
      this.logger.error(`Fallo de red al enviar a ${mensaje.para}`, e as Error);
      throw new InternalServerErrorException("No se pudo enviar el correo");
    }

    if (!respuesta.ok) {
      // El cuerpo del error de Resend trae el motivo (dominio no verificado,
      // destinatario inválido); sin loguearlo el fallo es indepurable.
      const detalle = await respuesta.text().catch(() => "");
      this.logger.error(
        `Resend respondió ${respuesta.status} al enviar a ${mensaje.para}: ${detalle}`,
      );
      throw new InternalServerErrorException("No se pudo enviar el correo");
    }
  }
}
