import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as webpush from "web-push";
import { PushService, type DestinoPush, type MensajePush, type ResultadoPush } from "./push.service";

/**
 * Push real con VAPID. A diferencia del correo y de R2, las claves son
 * opcionales: sin ellas el push queda apagado con un warning y el backend
 * arranca igual. Un recordatorio sin push sigue saliendo por correo.
 */
@Injectable()
export class WebPushService extends PushService {
  private readonly logger = new Logger(WebPushService.name);
  private readonly publica: string | null;

  constructor(config: ConfigService) {
    super();
    const publica = config.get<string>("VAPID_PUBLIC_KEY");
    const privada = config.get<string>("VAPID_PRIVATE_KEY");
    const subject = config.get<string>("VAPID_SUBJECT");
    if (publica && privada && subject) {
      webpush.setVapidDetails(subject, publica, privada);
      this.publica = publica;
    } else {
      this.publica = null;
      this.logger.warn("Push desactivado: faltan VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY o VAPID_SUBJECT.");
    }
  }

  clavePublica(): string | null {
    return this.publica;
  }

  async enviar(destino: DestinoPush, mensaje: MensajePush): Promise<ResultadoPush> {
    if (!this.publica) return "error";
    try {
      await webpush.sendNotification(
        { endpoint: destino.endpoint, keys: { p256dh: destino.p256dh, auth: destino.auth } },
        JSON.stringify(mensaje),
      );
      return "ok";
    } catch (e: any) {
      if (e?.statusCode === 404 || e?.statusCode === 410) return "expirada";
      this.logger.error(`Fallo al enviar push (${e?.statusCode ?? "sin status"})`);
      return "error";
    }
  }
}
