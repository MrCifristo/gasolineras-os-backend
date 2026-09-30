import { Injectable } from "@nestjs/common";
import {
  PushService,
  type DestinoPush,
  type MensajePush,
  type ResultadoPush,
} from "./push.service";

/** Fake en memoria para los tests: guarda lo enviado, sin red ni VAPID. */
@Injectable()
export class InMemoryPushService extends PushService {
  readonly enviados: { destino: DestinoPush; mensaje: MensajePush }[] = [];
  /** Endpoints que simulan una suscripción muerta (404/410). */
  readonly expirados = new Set<string>();
  clave: string | null = "clave-publica-de-prueba";

  clavePublica(): string | null {
    return this.clave;
  }

  enviar(destino: DestinoPush, mensaje: MensajePush): Promise<ResultadoPush> {
    if (this.expirados.has(destino.endpoint))
      return Promise.resolve("expirada");
    this.enviados.push({ destino: { ...destino }, mensaje: { ...mensaje } });
    return Promise.resolve("ok");
  }

  limpiar(): void {
    this.enviados.length = 0;
    this.expirados.clear();
  }
}
