// src/modules/turnos/recordatorios.service.spec.ts
import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { RecordatoriosService } from "./recordatorios.service";
import { espiarPrivado, vacio } from "../../../test/unit/dobles";

const config = (vars: Record<string, string | undefined>) =>
  ({ get: (k: string) => vars[k] }) as unknown as ConfigService;

describe("RecordatoriosService", () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it("con RECORDATORIOS_ACTIVOS=false el tick no ejecuta nada", async () => {
    const s = new RecordatoriosService(
      vacio(),
      config({ RECORDATORIOS_ACTIVOS: "false" }),
      vacio(),
      vacio(),
    );
    const spy = jest.spyOn(s, "ejecutar").mockResolvedValue({ enviados: [] });
    await s.tick();
    expect(spy).not.toHaveBeenCalled();
  });

  it("el tick nunca lanza aunque ejecutar falle", async () => {
    const s = new RecordatoriosService(vacio(), config({}), vacio(), vacio());
    const spy = jest
      .spyOn(s, "ejecutar")
      .mockRejectedValue(new Error("BD caída"));
    await expect(s.tick()).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("un turno que falla no impide enviar los demás", async () => {
    const s = new RecordatoriosService(vacio(), config({}), vacio(), vacio());
    espiarPrivado(s, "turnosCandidatos").mockResolvedValue([
      {
        gasolinera_id: "g1",
        gasolinera: "Uno",
        turno: "tarde",
        hora_inicio: "14:00",
      },
      {
        gasolinera_id: "g2",
        gasolinera: "Dos",
        turno: "tarde",
        hora_inicio: "14:00",
      },
    ]);
    const enviar = espiarPrivado(s, "procesarTurno")
      .mockRejectedValueOnce(new Error("Resend caído"))
      .mockResolvedValueOnce({
        gasolinera_id: "g2",
        turno: "tarde",
        fecha: "2026-09-25",
        correos: 1,
        push: 0,
      });
    const r = await s.ejecutar(new Date("2026-09-25T19:45:00Z")); // 13:45 GT
    expect(enviar).toHaveBeenCalledTimes(2);
    expect(r.enviados.map((e) => e.gasolinera_id)).toEqual(["g2"]);
  });
});
