import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as webpush from "web-push";
import { WebPushService } from "./web-push.service";

jest.mock("web-push", () => ({
  setVapidDetails: jest.fn(),
  sendNotification: jest.fn(),
}));

const config = (vars: Record<string, string | undefined>) =>
  ({ get: (k: string) => vars[k] }) as unknown as ConfigService;

const VAPID = {
  VAPID_PUBLIC_KEY: "pub",
  VAPID_PRIVATE_KEY: "priv",
  VAPID_SUBJECT: "mailto:admin@example.com",
};
const destino = { endpoint: "https://push.example/abc", p256dh: "p", auth: "a" };
const mensaje = { title: "t", body: "b", url: "/jefe" };

describe("WebPushService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // El servicio registra warnings/errores a propósito; no ensuciar la salida.
    jest.spyOn(Logger.prototype, "warn").mockImplementation();
    jest.spyOn(Logger.prototype, "error").mockImplementation();
  });

  it("sin VAPID queda desactivado: no expone clave y no envía", async () => {
    const s = new WebPushService(config({}));
    expect(s.clavePublica()).toBeNull();
    expect(await s.enviar(destino, mensaje)).toBe("error");
    expect(webpush.sendNotification).not.toHaveBeenCalled();
  });

  it("con VAPID envía el mensaje como JSON", async () => {
    (webpush.sendNotification as jest.Mock).mockResolvedValue({ statusCode: 201 });
    const s = new WebPushService(config(VAPID));
    expect(s.clavePublica()).toBe("pub");
    expect(await s.enviar(destino, mensaje)).toBe("ok");
    expect(webpush.sendNotification).toHaveBeenCalledWith(
      { endpoint: destino.endpoint, keys: { p256dh: "p", auth: "a" } },
      JSON.stringify(mensaje),
    );
  });

  it.each([404, 410])("un %i marca la suscripción como expirada", async (statusCode) => {
    (webpush.sendNotification as jest.Mock).mockRejectedValue({ statusCode });
    const s = new WebPushService(config(VAPID));
    expect(await s.enviar(destino, mensaje)).toBe("expirada");
  });

  it("un 500 es error, no expirada", async () => {
    (webpush.sendNotification as jest.Mock).mockRejectedValue({ statusCode: 500 });
    const s = new WebPushService(config(VAPID));
    expect(await s.enviar(destino, mensaje)).toBe("error");
  });
});
