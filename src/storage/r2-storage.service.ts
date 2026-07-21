import {
  Injectable,
  InternalServerErrorException,
  Logger,
  OnModuleInit,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  NoSuchKey,
} from "@aws-sdk/client-s3";
import { StorageObject, StorageService } from "./storage.service";

/**
 * Implementación sobre Cloudflare R2 (S3-compatible). Se usa el mismo SDK de S3;
 * R2 sólo cambia el endpoint, la región fija "auto" y el path-style.
 */
@Injectable()
export class R2StorageService extends StorageService implements OnModuleInit {
  private readonly logger = new Logger("R2Storage");
  private client!: S3Client;
  private bucket!: string;

  constructor(private readonly config: ConfigService) {
    super();
  }

  onModuleInit() {
    const endpoint = this.config.get<string>("R2_ENDPOINT");
    const accessKeyId = this.config.get<string>("R2_ACCESS_KEY_ID");
    const secretAccessKey = this.config.get<string>("R2_SECRET_ACCESS_KEY");
    const bucket = this.config.get<string>("R2_BUCKET");

    // Falla al arrancar si el storage está mal configurado, no en el primer
    // despacho (que es en la bomba y con un operario esperando).
    if (!endpoint || !accessKeyId || !secretAccessKey || !bucket) {
      throw new Error(
        "Faltan variables de R2 (R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET).",
      );
    }

    this.bucket = bucket;
    this.client = new S3Client({
      region: "auto",
      endpoint,
      forcePathStyle: true,
      credentials: { accessKeyId, secretAccessKey },
    });
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
        }),
      );
    } catch (e) {
      this.logger.error(`Fallo al subir ${key}`, e as Error);
      throw new InternalServerErrorException("No se pudo guardar la firma");
    }
  }

  async get(key: string): Promise<StorageObject | null> {
    try {
      const res = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      const body = Buffer.from(await res.Body!.transformToByteArray());
      return {
        body,
        contentType: res.ContentType ?? "application/octet-stream",
      };
    } catch (e) {
      if (e instanceof NoSuchKey) return null;
      this.logger.error(`Fallo al leer ${key}`, e as Error);
      throw new InternalServerErrorException("No se pudo leer la firma");
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.client.send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
      );
    } catch (e) {
      // El borrado es higiene (GC de huérfanos): loguear y seguir.
      this.logger.warn(`Fallo al borrar ${key}: ${(e as Error).message}`);
    }
  }
}
