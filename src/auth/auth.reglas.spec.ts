// src/auth/auth.reglas.spec.ts
import { BadRequestException } from "@nestjs/common";
import { esperarError } from "../../test/unit/esperar-error";
import {
  exigirTokenResetVigente,
  exigirUsuarioActivoParaReset,
  normalizarIdentificador,
} from "./auth.reglas";

const MENSAJE = "El enlace de recuperación no es válido o ya venció";
const ahora = new Date("2026-10-07T12:00:00Z");

describe("normalizarIdentificador", () => {
  it("recorta y baja a minúsculas un correo", () => {
    expect(normalizarIdentificador("  Ana@X.com ")).toBe("ana@x.com");
  });

  it("recorta un teléfono sin bajarlo", () => {
    expect(normalizarIdentificador(" 5555-1234 ")).toBe("5555-1234");
  });

  it("sin arroba no toca las mayúsculas", () => {
    expect(normalizarIdentificador("ABC")).toBe("ABC");
  });
});

describe("exigirTokenResetVigente", () => {
  const vigente = {
    usado_at: null,
    expira_at: new Date(ahora.getTime() + 1000),
  };

  it("fila inexistente: 400", () => {
    esperarError(
      () => exigirTokenResetVigente(undefined, ahora),
      BadRequestException,
      MENSAJE,
    );
  });

  it("token usado: 400", () => {
    esperarError(
      () => exigirTokenResetVigente({ ...vigente, usado_at: ahora }, ahora),
      BadRequestException,
      MENSAJE,
    );
  });

  it("token vencido: 400", () => {
    esperarError(
      () =>
        exigirTokenResetVigente(
          { ...vigente, expira_at: new Date(ahora.getTime() - 1) },
          ahora,
        ),
      BadRequestException,
      MENSAJE,
    );
  });

  it("expira_at igual a ahora ya está vencido", () => {
    esperarError(
      () => exigirTokenResetVigente({ ...vigente, expira_at: ahora }, ahora),
      BadRequestException,
      MENSAJE,
    );
  });

  it("token vigente: pasa", () => {
    expect(() => exigirTokenResetVigente(vigente, ahora)).not.toThrow();
  });
});

describe("exigirUsuarioActivoParaReset", () => {
  it("usuario inexistente: 400", () => {
    esperarError(
      () => exigirUsuarioActivoParaReset(undefined),
      BadRequestException,
      MENSAJE,
    );
  });

  it("usuario inactivo: 400", () => {
    esperarError(
      () => exigirUsuarioActivoParaReset({ activo: false }),
      BadRequestException,
      MENSAJE,
    );
  });

  it("usuario activo: pasa", () => {
    expect(() => exigirUsuarioActivoParaReset({ activo: true })).not.toThrow();
  });
});
