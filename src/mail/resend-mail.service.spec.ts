// src/mail/resend-mail.service.spec.ts
import { InternalServerErrorException, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { esperarRechazo } from "../../test/unit/esperar-error";
import { ResendMailService } from "./resend-mail.service";

const config = (vars: Record<string, string | undefined>) =>
  ({ get: (k: string) => vars[k] }) as unknown as ConfigService;

const VARS = { RESEND_API_KEY: "re_clave", MAIL_FROM: "La Estación <a@b.gt>" };

const MENSAJE = {
  para: "cliente@ejemplo.gt",
  asunto: "Hola",
  html: "<p>Hola</p>",
  texto: "Hola",
};

function armar() {
  const s = new ResendMailService(config(VARS));
  s.onModuleInit();
  return s;
}

describe("ResendMailService", () => {
  let error: jest.SpyInstance;

  beforeEach(() => {
    error = jest.spyOn(Logger.prototype, "error").mockImplementation();
  });
  afterEach(() => jest.restoreAllMocks());

  it.each(["RESEND_API_KEY", "MAIL_FROM"])("sin %s no arranca", (faltante) => {
    const s = new ResendMailService(config({ ...VARS, [faltante]: undefined }));
    expect(() => s.onModuleInit()).toThrow(/^Faltan variables de correo/);
  });

  it("hace un POST a Resend con Bearer y el cuerpo esperado", async () => {
    const fetchSpy = jest
      .spyOn(global, "fetch")
      .mockResolvedValue(new Response("{}", { status: 200 }));

    await armar().enviar(MENSAJE);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>).Authorization).toBe(
      "Bearer re_clave",
    );
    expect(JSON.parse(init?.body as string)).toEqual({
      from: "La Estación <a@b.gt>",
      to: ["cliente@ejemplo.gt"],
      subject: "Hola",
      html: "<p>Hola</p>",
      text: "Hola",
    });
  });

  it("un envío aceptado queda en el log con el id de Resend", async () => {
    jest
      .spyOn(global, "fetch")
      .mockResolvedValue(new Response('{"id":"re-123"}', { status: 200 }));
    const log = jest.spyOn(Logger.prototype, "log").mockImplementation();

    await armar().enviar(MENSAJE);

    expect(log).toHaveBeenCalledWith(
      'Correo "Hola" aceptado por Resend para cliente@ejemplo.gt (id re-123)',
    );
  });

  it("si la respuesta no trae id, el log lo dice en vez de fallar", async () => {
    jest
      .spyOn(global, "fetch")
      .mockResolvedValue(new Response("no-json", { status: 200 }));
    const log = jest.spyOn(Logger.prototype, "log").mockImplementation();

    await expect(armar().enviar(MENSAJE)).resolves.toBeUndefined();

    expect(log).toHaveBeenCalledWith(
      'Correo "Hola" aceptado por Resend para cliente@ejemplo.gt (id ?)',
    );
  });

  it("un fallo de red responde 500 «No se pudo enviar el correo»", async () => {
    jest.spyOn(global, "fetch").mockRejectedValue(new Error("ECONNRESET"));
    await esperarRechazo(
      armar().enviar(MENSAJE),
      InternalServerErrorException,
      "No se pudo enviar el correo",
    );
    expect(error).toHaveBeenCalled();
  });

  it("un 403 con «dominio no verificado» da el mismo 500 y el log lleva status y detalle", async () => {
    jest
      .spyOn(global, "fetch")
      .mockResolvedValue(
        new Response("dominio no verificado", { status: 403 }),
      );
    await esperarRechazo(
      armar().enviar(MENSAJE),
      InternalServerErrorException,
      "No se pudo enviar el correo",
    );
    const log = String((error.mock.calls as string[][])[0][0]);
    expect(log).toContain("403");
    expect(log).toContain("dominio no verificado");
  });
});
