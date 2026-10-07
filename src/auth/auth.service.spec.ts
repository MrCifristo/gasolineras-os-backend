// src/auth/auth.service.spec.ts
import { UnauthorizedException } from "@nestjs/common";
import { esperarRechazo } from "../../test/unit/esperar-error";
import type { DbService } from "../db/db.service";
import { AuthService } from "./auth.service";
import type { PasswordService } from "./password.service";
import type { SessionService } from "./session.service";
import type { TokenService } from "./token.service";

const usuario = (extra: Record<string, unknown> = {}) => ({
  id: "u1",
  email: "ana@x.com",
  telefono: "5555-1234",
  nombre: "Ana",
  rol: "supervisor",
  gasolinera_id: "g1",
  cliente_id: null,
  activo: true,
  password_hash: "hash-guardado",
  ...extra,
});

describe("AuthService", () => {
  let hashear: jest.Mock;
  let verificar: jest.Mock;
  let firmarAccess: jest.Mock;
  let crear: jest.Mock;
  let rotar: jest.Mock;
  let s: AuthService;
  let buscar: jest.SpyInstance;

  beforeEach(() => {
    hashear = jest.fn().mockResolvedValue("hash-senuelo");
    verificar = jest.fn().mockResolvedValue(true);
    firmarAccess = jest.fn().mockReturnValue("jwt-firmado");
    crear = jest
      .fn()
      .mockResolvedValue({ sid: "sid-1", refreshToken: "refresh-1" });
    rotar = jest.fn();
    s = new AuthService(
      {} as unknown as DbService,
      { hashear, verificar } as unknown as PasswordService,
      { firmarAccess } as unknown as TokenService,
      { crear, rotar } as unknown as SessionService,
    );
    buscar = jest.spyOn(s as any, "buscarPorIdentificador");
  });
  afterEach(() => jest.restoreAllMocks());

  it("busca el correo normalizado", async () => {
    buscar.mockResolvedValue(usuario());
    await s.login({ identificador: "  Ana@X.com ", password: "p" });
    expect(buscar).toHaveBeenCalledWith("ana@x.com");
  });

  it("usuario inexistente: verifica contra el señuelo y responde 401", async () => {
    buscar.mockResolvedValue(undefined);
    await esperarRechazo(
      s.login({ identificador: "nadie@x.com", password: "p" }),
      UnauthorizedException,
      "Credenciales inválidas",
    );
    expect(verificar).toHaveBeenCalledWith("hash-senuelo", "p");
    expect(crear).not.toHaveBeenCalled();
  });

  it("el señuelo se hashea una sola vez en dos intentos", async () => {
    buscar.mockResolvedValue(undefined);
    for (let i = 0; i < 2; i++) {
      await s
        .login({ identificador: "nadie@x.com", password: "p" })
        .catch(() => undefined);
    }
    expect(hashear).toHaveBeenCalledTimes(1);
  });

  it("contraseña mala: 401 y no abre sesión", async () => {
    buscar.mockResolvedValue(usuario());
    verificar.mockResolvedValue(false);
    await esperarRechazo(
      s.login({ identificador: "ana@x.com", password: "mala" }),
      UnauthorizedException,
      "Credenciales inválidas",
    );
    expect(verificar).toHaveBeenCalledWith("hash-guardado", "mala");
    expect(crear).not.toHaveBeenCalled();
  });

  it("usuario inactivo con la contraseña correcta: el mismo 401", async () => {
    buscar.mockResolvedValue(usuario({ activo: false }));
    await esperarRechazo(
      s.login({ identificador: "ana@x.com", password: "p" }),
      UnauthorizedException,
      "Credenciales inválidas",
    );
    // Anti-enumeración por tiempo: se verifica igual contra el hash guardado.
    expect(verificar).toHaveBeenCalledWith("hash-guardado", "p");
    expect(crear).not.toHaveBeenCalled();
  });

  it("login correcto: abre sesión con meta, firma los claims y responde sin password_hash", async () => {
    const u = usuario();
    buscar.mockResolvedValue(u);
    const meta = { ip: "1.2.3.4", userAgent: "jest" };
    const r = await s.login(
      { identificador: "ana@x.com", password: "p" },
      meta,
    );

    expect(crear).toHaveBeenCalledWith(u, meta);
    expect(firmarAccess).toHaveBeenCalledWith({
      sub: "u1",
      rol: "supervisor",
      gasolinera_id: "g1",
      cliente_id: null,
      sid: "sid-1",
    });
    expect(r.access_token).toBe("jwt-firmado");
    expect(r.refresh_token).toBe("refresh-1");
    expect(r.expires_in).toBe(900);
    expect(r.usuario).toEqual({
      id: "u1",
      email: "ana@x.com",
      telefono: "5555-1234",
      nombre: "Ana",
      rol: "supervisor",
      gasolinera_id: "g1",
      cliente_id: null,
    });
    expect(r.usuario).not.toHaveProperty("password_hash");
  });

  it("el refresh firma con el sid y el refresh token de la sesión rotada", async () => {
    rotar.mockResolvedValue({
      usuario: usuario(),
      sesion: { sid: "sid-2", refreshToken: "refresh-2" },
    });
    const r = await s.refresh("refresh-1", { ip: "9.9.9.9" });

    expect(rotar).toHaveBeenCalledWith("refresh-1", { ip: "9.9.9.9" });
    expect(firmarAccess).toHaveBeenCalledWith(
      expect.objectContaining({ sub: "u1", sid: "sid-2" }),
    );
    expect(r.refresh_token).toBe("refresh-2");
    expect(r.expires_in).toBe(900);
  });
});
