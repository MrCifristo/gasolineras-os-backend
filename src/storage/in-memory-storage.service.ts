import { Injectable } from "@nestjs/common";
import { StorageObject, StorageService } from "./storage.service";

/**
 * Fake en memoria de StorageService para los tests: sin red, sin R2, sin MinIO.
 * Permite ejercitar el round-trip completo de firma de forma hermética.
 */
@Injectable()
export class InMemoryStorageService extends StorageService {
  private readonly objetos = new Map<string, StorageObject>();

  put(key: string, body: Buffer, contentType: string): Promise<void> {
    this.objetos.set(key, { body: Buffer.from(body), contentType });
    return Promise.resolve();
  }

  get(key: string): Promise<StorageObject | null> {
    return Promise.resolve(this.objetos.get(key) ?? null);
  }

  delete(key: string): Promise<void> {
    this.objetos.delete(key);
    return Promise.resolve();
  }
}
