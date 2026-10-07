// src/auth/session.reglas.spec.ts
import { UnauthorizedException } from "@nestjs/common";
import { esperarError } from "../../test/unit/esperar-error";
import {
  ReplayError,
  sesionPosteriorAlPassword,
  validarSesionParaRotar,
  validarUsuarioDeSesion,
  vencimientoRotado,
  vencimientosIniciales,
} from "./session.reglas";

const T = new Date("2026-10-07T12:00:00.000Z");
const DIA = 24 * 60 * 60 * 1000;
const en = (dias: number) => new Date(T.getTime() + dias * DIA);

describe("vencimientosIniciales", () => {
  it("supervisor: 30 días de refresh y 90 de familia", () => {
    const { expira, familiaExpira } = vencimientosIniciales(
      "supervisor",
      T.getTime(),
    );
    expect(expira).toEqual(en(30));
    expect(familiaExpira).toEqual(en(90));
  });

  it.each(["admin", "cliente", "jefe_pista"] as const)(
    "%s: 7 días de refresh y 30 de familia",
    (rol) => {
      const { expira, familiaExpira } = vencimientosIniciales(rol, T.getTime());
      expect(expira).toEqual(en(7));
      expect(familiaExpira).toEqual(en(30));
    },
  );
});

describe("validarSesionParaRotar", () => {
  const vigente = () => ({
    revocado_at: null as Date | null,
    usado_at: null as Date | null,
    familia_id: "fam-1",
    expira_at: en(1),
    familia_expira_at: en(10),
  });

  it("sin sesión: 401 Sesión inválida", () => {
    esperarError(
      () => validarSesionParaRotar(undefined, T),
      UnauthorizedException,
      "Sesión inválida",
    );
  });

  it("revocada: 401 Sesión revocada", () => {
    esperarError(
      () => validarSesionParaRotar({ ...vigente(), revocado_at: T }, T),
      UnauthorizedException,
      "Sesión revocada",
    );
  });

  it("revocada gana aunque también esté usada", () => {
    esperarError(
      () =>
        validarSesionParaRotar(
          { ...vigente(), revocado_at: T, usado_at: T },
          T,
        ),
      UnauthorizedException,
      "Sesión revocada",
    );
  });

  it("usada: lanza ReplayError con la familia", () => {
    let capturado: unknown;
    try {
      validarSesionParaRotar({ ...vigente(), usado_at: T }, T);
    } catch (e) {
      capturado = e;
    }
    expect(capturado).toBeInstanceOf(ReplayError);
    expect((capturado as ReplayError).familiaId).toBe("fam-1");
  });

  // Seguridad: una sesión ya canjeada y además vencida sigue siendo un replay.
  // Si ganara "Sesión expirada", un refresh robado y reusado tras vencer no
  // revocaría la familia.
  it("usada y con expira_at vencido: ReplayError, no Sesión expirada", () => {
    let capturado: unknown;
    try {
      validarSesionParaRotar(
        { ...vigente(), usado_at: T, expira_at: en(-1) },
        T,
      );
    } catch (e) {
      capturado = e;
    }
    expect(capturado).toBeInstanceOf(ReplayError);
    expect((capturado as ReplayError).familiaId).toBe("fam-1");
  });

  it("usada y con familia_expira_at vencido: ReplayError, no Sesión expirada", () => {
    let capturado: unknown;
    try {
      validarSesionParaRotar(
        { ...vigente(), usado_at: T, familia_expira_at: en(-1) },
        T,
      );
    } catch (e) {
      capturado = e;
    }
    expect(capturado).toBeInstanceOf(ReplayError);
    expect((capturado as ReplayError).familiaId).toBe("fam-1");
  });

  it("expira_at igual a ahora: 401 Sesión expirada", () => {
    esperarError(
      () => validarSesionParaRotar({ ...vigente(), expira_at: T }, T),
      UnauthorizedException,
      "Sesión expirada",
    );
  });

  it("familia_expira_at igual a ahora: 401 Sesión expirada", () => {
    esperarError(
      () => validarSesionParaRotar({ ...vigente(), familia_expira_at: T }, T),
      UnauthorizedException,
      "Sesión expirada",
    );
  });

  it("vigente: pasa", () => {
    expect(() => validarSesionParaRotar(vigente(), T)).not.toThrow();
  });
});

describe("validarUsuarioDeSesion", () => {
  const usuario = { activo: true, password_actualizado_at: T };

  it("sin usuario: 401 Usuario inactivo", () => {
    esperarError(
      () => validarUsuarioDeSesion(undefined, T),
      UnauthorizedException,
      "Usuario inactivo",
    );
  });

  it("usuario inactivo: 401 Usuario inactivo", () => {
    esperarError(
      () => validarUsuarioDeSesion({ ...usuario, activo: false }, T),
      UnauthorizedException,
      "Usuario inactivo",
    );
  });

  it("sesión creada antes del cambio de contraseña: 401", () => {
    esperarError(
      () => validarUsuarioDeSesion(usuario, en(-1)),
      UnauthorizedException,
      "Sesión anterior al cambio de contraseña",
    );
  });

  it("sesión creada en el mismo instante del cambio: pasa", () => {
    expect(() => validarUsuarioDeSesion(usuario, T)).not.toThrow();
  });
});

describe("sesionPosteriorAlPassword", () => {
  it("anterior: false; igual o posterior: true", () => {
    expect(sesionPosteriorAlPassword(en(-1), T)).toBe(false);
    expect(sesionPosteriorAlPassword(T, T)).toBe(true);
    expect(sesionPosteriorAlPassword(en(1), T)).toBe(true);
  });
});

describe("vencimientoRotado", () => {
  it("con la familia lejos: ahora + 7 días", () => {
    expect(vencimientoRotado("admin", T, en(30))).toEqual(en(7));
  });

  it("con la familia a 2 días: se topa en familiaExpiraAt", () => {
    expect(vencimientoRotado("admin", T, en(2))).toEqual(en(2));
  });
});
