// src/auth/auth.guard.spec.ts
import { ExecutionContext, UnauthorizedException } from "@nestjs/common";
import { esperarRechazo } from "../../test/unit/esperar-error";
import { AuthGuard, COOKIE_ACCESS } from "./auth.guard";
import type { SessionService } from "./session.service";
import type { TokenService } from "./token.service";

const contexto = (req: object) =>
  ({
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => ({}) }),
  }) as unknown as ExecutionContext;

describe("AuthGuard", () => {
  let verificarAccess: jest.Mock;
  let usuarioDeSesionViva: jest.Mock;
  let guard: AuthGuard;

  beforeEach(() => {
    verificarAccess = jest.fn();
    usuarioDeSesionViva = jest.fn();
    guard = new AuthGuard(
      { verificarAccess } as unknown as TokenService,
      { usuarioDeSesionViva } as unknown as SessionService,
    );
  });

  it("sin token: 401 Token requerido", async () => {
    await esperarRechazo(
      guard.canActivate(contexto({ headers: {} })),
      UnauthorizedException,
      "Token requerido",
    );
  });

  it("con un header Basic: 401 Token requerido", async () => {
    await esperarRechazo(
      guard.canActivate(
        contexto({ headers: { authorization: "Basic abc123" } }),
      ),
      UnauthorizedException,
      "Token requerido",
    );
  });

  it("toma el token del header Bearer", async () => {
    verificarAccess.mockReturnValue(null);
    await guard
      .canActivate(contexto({ headers: { authorization: "Bearer tok-h" } }))
      .catch(() => undefined);
    expect(verificarAccess).toHaveBeenCalledWith("tok-h");
  });

  it("la cookie ef_at gana sobre el header", async () => {
    verificarAccess.mockReturnValue(null);
    await guard
      .canActivate(
        contexto({
          cookies: { [COOKIE_ACCESS]: "tok-c" },
          headers: { authorization: "Bearer tok-h" },
        }),
      )
      .catch(() => undefined);
    expect(verificarAccess).toHaveBeenCalledWith("tok-c");
  });

  it("token inválido: 401 Token inválido, sin consultar la sesión", async () => {
    verificarAccess.mockReturnValue(null);
    await esperarRechazo(
      guard.canActivate(
        contexto({ headers: { authorization: "Bearer malo" } }),
      ),
      UnauthorizedException,
      "Token inválido",
    );
    expect(usuarioDeSesionViva).not.toHaveBeenCalled();
  });

  it("sesión muerta: 401 Sesión no vigente, consultada con claims.sid", async () => {
    verificarAccess.mockReturnValue({ sid: "sid-9" });
    usuarioDeSesionViva.mockResolvedValue(null);
    await esperarRechazo(
      guard.canActivate(contexto({ headers: { authorization: "Bearer t" } })),
      UnauthorizedException,
      "Sesión no vigente",
    );
    expect(usuarioDeSesionViva).toHaveBeenCalledWith("sid-9");
  });

  it("caso válido: devuelve true y deja req.user", async () => {
    const usuario = { id: "u1", rol: "admin" };
    verificarAccess.mockReturnValue({ sid: "sid-1" });
    usuarioDeSesionViva.mockResolvedValue(usuario);
    const req: { headers: object; user?: unknown } = {
      headers: { authorization: "Bearer t" },
    };
    await expect(guard.canActivate(contexto(req))).resolves.toBe(true);
    expect(req.user).toBe(usuario);
  });
});
