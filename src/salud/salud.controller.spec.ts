import { ServiceUnavailableException } from "@nestjs/common";
import { SaludController } from "./salud.controller";
import { DbService } from "../db/db.service";

function controladorCon(execute: jest.Mock) {
  return new SaludController({ db: { execute } } as unknown as DbService);
}

describe("SaludController", () => {
  it("responde ok cuando la base contesta", async () => {
    const execute = jest.fn().mockResolvedValue({ rows: [] });
    await expect(controladorCon(execute).verificar()).resolves.toEqual({
      estado: "ok",
    });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("responde 503 sin filtrar el error cuando la base no contesta", async () => {
    const execute = jest
      .fn()
      .mockRejectedValue(new Error("connect ECONNREFUSED 10.0.0.5:5432"));
    const promesa = controladorCon(execute).verificar();
    await expect(promesa).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(promesa).rejects.toThrow("Base de datos no disponible");
  });
});
