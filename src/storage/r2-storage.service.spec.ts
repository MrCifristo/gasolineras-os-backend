// src/storage/r2-storage.service.spec.ts
import { InternalServerErrorException, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NoSuchKey, PutObjectCommand } from "@aws-sdk/client-s3";
import { esperarRechazo } from "../../test/unit/esperar-error";
import { R2StorageService } from "./r2-storage.service";

const VARS = {
  R2_ENDPOINT: "http://localhost:9000",
  R2_ACCESS_KEY_ID: "clave",
  R2_SECRET_ACCESS_KEY: "secreto",
  R2_BUCKET: "firmas",
};

const config = (vars: Record<string, string | undefined>) =>
  ({ get: (k: string) => vars[k] }) as unknown as ConfigService;

function armar() {
  const s = new R2StorageService(config(VARS));
  s.onModuleInit();
  const send = jest.fn<Promise<unknown>, [PutObjectCommand]>();
  Object.assign(s, { client: { send } });
  return { s, send };
}

describe("R2StorageService", () => {
  let error: jest.SpyInstance;
  let warn: jest.SpyInstance;

  beforeEach(() => {
    error = jest.spyOn(Logger.prototype, "error").mockImplementation();
    warn = jest.spyOn(Logger.prototype, "warn").mockImplementation();
  });
  afterEach(() => jest.restoreAllMocks());

  it.each(Object.keys(VARS))("sin %s no arranca", (faltante) => {
    const s = new R2StorageService(config({ ...VARS, [faltante]: undefined }));
    expect(() => s.onModuleInit()).toThrow(/^Faltan variables de R2/);
  });

  it("put manda un PutObjectCommand con bucket, llave, cuerpo y tipo", async () => {
    const { s, send } = armar();
    send.mockResolvedValue({});
    const cuerpo = Buffer.from("firma");

    await s.put("firmas/a.png", cuerpo, "image/png");

    expect(send).toHaveBeenCalledTimes(1);
    const cmd = send.mock.calls[0][0];
    expect(cmd).toBeInstanceOf(PutObjectCommand);
    expect(cmd.input).toEqual({
      Bucket: "firmas",
      Key: "firmas/a.png",
      Body: cuerpo,
      ContentType: "image/png",
    });
  });

  it("si put falla responde 500 «No se pudo guardar la firma»", async () => {
    const { s, send } = armar();
    send.mockRejectedValue(new Error("red caída"));
    await esperarRechazo(
      s.put("k", Buffer.from("x"), "image/png"),
      InternalServerErrorException,
      "No se pudo guardar la firma",
    );
    expect(error).toHaveBeenCalled();
  });

  it("get devuelve el cuerpo y el content type", async () => {
    const { s, send } = armar();
    send.mockResolvedValue({
      Body: {
        transformToByteArray: () => Promise.resolve(new Uint8Array([1, 2, 3])),
      },
      ContentType: "image/png",
    });
    const r = await s.get("k");
    expect(r).toEqual({
      body: Buffer.from([1, 2, 3]),
      contentType: "image/png",
    });
  });

  it("get sin content type usa application/octet-stream", async () => {
    const { s, send } = armar();
    send.mockResolvedValue({
      Body: {
        transformToByteArray: () => Promise.resolve(new Uint8Array([9])),
      },
    });
    const r = await s.get("k");
    expect(r?.contentType).toBe("application/octet-stream");
  });

  it("get de una llave inexistente (NoSuchKey) devuelve null", async () => {
    const { s, send } = armar();
    send.mockRejectedValue(
      new NoSuchKey({ $metadata: {}, message: "no existe" }),
    );
    await expect(s.get("k")).resolves.toBeNull();
    expect(error).not.toHaveBeenCalled();
  });

  it("get con otro error responde 500 «No se pudo leer la firma»", async () => {
    const { s, send } = armar();
    send.mockRejectedValue(new Error("timeout"));
    await esperarRechazo(
      s.get("k"),
      InternalServerErrorException,
      "No se pudo leer la firma",
    );
    expect(error).toHaveBeenCalled();
  });

  it("delete fallido no lanza y registra un warn", async () => {
    const { s, send } = armar();
    send.mockRejectedValue(new Error("denegado"));
    await expect(s.delete("k")).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith("Fallo al borrar k: denegado");
  });

  it("delete exitoso no registra nada", async () => {
    const { s, send } = armar();
    send.mockResolvedValue({});
    await s.delete("k");
    expect(send).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
  });
});
