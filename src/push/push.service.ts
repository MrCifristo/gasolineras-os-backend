/**
 * Web Push. Se define como clase abstracta, igual que MailService y
 * StorageService, para inyectar un fake en memoria en los tests.
 */
export interface MensajePush {
  title: string;
  body: string;
  /** Ruta del frontend que abre la notificación al tocarla. */
  url: string;
}

export interface DestinoPush {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** 'expirada' = el navegador ya no reconoce la suscripción (404/410): borrarla. */
export type ResultadoPush = "ok" | "expirada" | "error";

export abstract class PushService {
  /** Clave pública VAPID, o null si el push está desactivado. */
  abstract clavePublica(): string | null;
  abstract enviar(
    destino: DestinoPush,
    mensaje: MensajePush,
  ): Promise<ResultadoPush>;
}
