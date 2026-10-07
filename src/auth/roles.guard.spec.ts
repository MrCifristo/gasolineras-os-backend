// src/auth/roles.guard.spec.ts
import { ExecutionContext, ForbiddenException } from "@nestjs/common";
import type { Reflector } from "@nestjs/core";
import { esperarError } from "../../test/unit/esperar-error";
import { RolesGuard } from "./roles.guard";

const contexto = (user?: { rol: string }) =>
  ({
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({
      getRequest: () => ({ user }),
      getResponse: () => ({}),
    }),
  }) as unknown as ExecutionContext;

const guardCon = (roles: unknown) =>
  new RolesGuard({
    getAllAndOverride: () => roles,
  } as unknown as Reflector);

describe("RolesGuard", () => {
  it("sin metadata de roles admite a cualquier autenticado (@Auth() a secas)", () => {
    expect(guardCon(undefined).canActivate(contexto({ rol: "cliente" }))).toBe(
      true,
    );
  });

  it("con una lista vacía también admite", () => {
    expect(guardCon([]).canActivate(contexto({ rol: "cliente" }))).toBe(true);
  });

  it("rol incluido: true", () => {
    expect(
      guardCon(["admin", "supervisor"]).canActivate(contexto({ rol: "admin" })),
    ).toBe(true);
  });

  it("rol ajeno: 403 Permisos insuficientes", () => {
    esperarError(
      () => guardCon(["admin"]).canActivate(contexto({ rol: "cliente" })),
      ForbiddenException,
      "Permisos insuficientes",
    );
  });

  it("sin usuario: 403 Permisos insuficientes", () => {
    esperarError(
      () => guardCon(["admin"]).canActivate(contexto(undefined)),
      ForbiddenException,
      "Permisos insuficientes",
    );
  });
});
