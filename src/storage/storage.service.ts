/**
 * Almacenamiento de objetos (firmas de piloto). Se define como interfaz para
 * poder inyectar un fake en memoria en los tests sin tocar R2.
 */
export interface StorageObject {
  body: Buffer;
  contentType: string;
}

export abstract class StorageService {
  abstract put(key: string, body: Buffer, contentType: string): Promise<void>;
  abstract get(key: string): Promise<StorageObject | null>;
  abstract delete(key: string): Promise<void>;
}
