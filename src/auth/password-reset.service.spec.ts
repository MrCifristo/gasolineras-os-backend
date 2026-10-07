// src/auth/password-reset.service.spec.ts
import { BadRequestException, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { esperarRechazo } from "../../test/unit/esperar-error";
import type { DbService } from "../db/db.service";
import type { MailService } from "../mail/mail.service";
import { PasswordResetService } from "./password-reset.service";
import type { PasswordService } from "./password.service";
import type { SessionService } from "./session.service";

interface CorreoEnviado {
  para: string;
  texto: string;
  html: string;
}

const config = (vars: Record<string, string | undefined>) =>
  ({ get: (k: string) => vars[k] }) as unknown as ConfigService;

describe("PasswordResetService", () => {
  let enviar: jest.Mock<Promise<void>, [CorreoEnviado]>;
  let errorLog: jest.SpyInstance;

  const crear = (vars: Record<string, string | undefined> = {}) => {
    const s = new PasswordResetService(
      {} as unknown as DbService,
      {} as unknown as PasswordService,
      {} as unknown as SessionService,
      { enviar } as unknown as MailService,
      config(vars),
    );
    const emitir = jest.spyOn(s, "emitirToken").mockResolvedValue("tok-123");
    return { s, emitir };
  };

  beforeEach(() => {
    enviar = jest.fn<Promise<void>, [CorreoEnviado]>().mockResolvedValue();
    errorLog = jest.spyOn(Logger.prototype, "error").mockImplementation();
  });
  afterEach(() => jest.restoreAllMocks());

  describe("enviarEnlace", () => {
    it("sin correo: 400 y no emite token", async () => {
      const { s, emitir } = crear();
      await esperarRechazo(
        s.enviarEnlace({ id: "u1", email: null, nombre: "Ana" }),
        BadRequestException,
        "El usuario no tiene correo registrado; usá el modo de contraseña generada",
      );
      expect(emitir).not.toHaveBeenCalled();
      expect(enviar).not.toHaveBeenCalled();
    });

    it("con FRONTEND_URL terminada en / el enlace no lleva doble barra", async () => {
      const { s } = crear({ FRONTEND_URL: "https://app.test/" });
      await s.enviarEnlace({ id: "u1", email: "a@x.com", nombre: "Ana" });
      const correo = enviar.mock.calls[0][0];
      expect(correo.para).toBe("a@x.com");
      expect(correo.texto).toContain("https://app.test/reset?token=tok-123");
      expect(correo.texto).not.toContain("//reset");
    });

    it("sin FRONTEND_URL el enlace es relativo (se fija como está)", async () => {
      const { s } = crear();
      await s.enviarEnlace({ id: "u1", email: "a@x.com", nombre: "Ana" });
      expect(enviar.mock.calls[0][0].texto).toContain("\n/reset?token=tok-123");
    });

    it("el nombre va escapado en el HTML y crudo en el texto", async () => {
      const { s } = crear();
      await s.enviarEnlace({
        id: "u1",
        email: "a@x.com",
        nombre: "<b>Ana</b>",
      });
      const correo = enviar.mock.calls[0][0];
      expect(correo.html).toContain("&lt;b&gt;Ana&lt;/b&gt;");
      expect(correo.html).not.toContain("<b>Ana</b>");
      expect(correo.texto).toContain("Hola <b>Ana</b>:");
    });
  });

  describe("solicitar", () => {
    const preparar = (fila: unknown) => {
      const { s } = crear();
      const buscar = jest
        .spyOn(s as any, "buscarPorIdentificador")
        .mockResolvedValue(fila);
      const enlace = jest.spyOn(s, "enviarEnlace").mockResolvedValue();
      return { s, buscar, enlace };
    };

    it("normaliza el identificador", async () => {
      const { s, buscar } = preparar(undefined);
      await s.solicitar("  Ana@X.com ");
      expect(buscar).toHaveBeenCalledWith("ana@x.com");
    });

    it.each([
      ["inexistente", undefined],
      ["inactivo", { id: "u1", activo: false, email: "a@x.com" }],
      ["sin correo", { id: "u1", activo: true, email: null }],
    ])("usuario %s: no envía y resuelve sin error", async (_n, fila) => {
      const { s, enlace } = preparar(fila);
      await expect(s.solicitar("x@x.com")).resolves.toBeUndefined();
      expect(enlace).not.toHaveBeenCalled();
    });

    it("usuario válido: envía el enlace", async () => {
      const fila = { id: "u1", activo: true, email: "a@x.com", nombre: "Ana" };
      const { s, enlace } = preparar(fila);
      await s.solicitar("a@x.com");
      expect(enlace).toHaveBeenCalledWith(fila);
    });

    it("si el proveedor falla resuelve igual y registra el error", async () => {
      const fila = { id: "u1", activo: true, email: "a@x.com", nombre: "Ana" };
      const { s, enlace } = preparar(fila);
      enlace.mockRejectedValue(new Error("Resend caído"));
      await expect(s.solicitar("a@x.com")).resolves.toBeUndefined();
      expect(errorLog).toHaveBeenCalledWith(
        "No se pudo enviar el reset a a@x.com",
        expect.any(Error),
      );
    });
  });
});
