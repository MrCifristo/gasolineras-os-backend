// src/common/bloqueos.reglas.spec.ts
import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { esperarError } from "../../test/unit/esperar-error";
import {
  exigirClienteConCredito,
  exigirGasolineraOperable,
  exigirRol,
} from "./bloqueos.reglas";

describe("exigirRol", () => {
  const permitidos = ["supervisor", "admin"];
  const mensaje = "Solo supervisores pueden crear despachos";

  it.each(["supervisor", "admin"])("deja pasar al rol %s", (rol) => {
    expect(() => exigirRol(rol, permitidos, mensaje)).not.toThrow();
  });

  it.each(["cliente", undefined])("rechaza con 403 al rol %s", (rol) => {
    esperarError(
      () => exigirRol(rol, permitidos, mensaje),
      ForbiddenException,
      mensaje,
    );
  });
});

describe("exigirGasolineraOperable", () => {
  it("gasolinera inexistente: 404", () => {
    esperarError(
      () => exigirGasolineraOperable(undefined),
      NotFoundException,
      "Gasolinera no encontrada",
    );
  });

  it("gasolinera bloqueada: 403", () => {
    esperarError(
      () => exigirGasolineraOperable({ bloqueado: true }),
      ForbiddenException,
      "Gasolinera bloqueada — contacte al administrador",
    );
  });

  it("gasolinera activa pasa", () => {
    expect(() => exigirGasolineraOperable({ bloqueado: false })).not.toThrow();
  });
});

describe("exigirClienteConCredito", () => {
  it("cliente inexistente: 404", () => {
    esperarError(
      () => exigirClienteConCredito(undefined),
      NotFoundException,
      "Cliente no encontrado",
    );
  });

  it("cuenta bloqueada: 403", () => {
    esperarError(
      () =>
        exigirClienteConCredito({ bloqueado: true, credito_bloqueado: false }),
      ForbiddenException,
      "Cuenta bloqueada por el cliente",
    );
  });

  it("crédito bloqueado: 403 con mensaje propio", () => {
    esperarError(
      () =>
        exigirClienteConCredito({ bloqueado: false, credito_bloqueado: true }),
      ForbiddenException,
      "Crédito suspendido — consulte con administración",
    );
  });

  it("con los dos bloqueos gana el de la cuenta", () => {
    esperarError(
      () =>
        exigirClienteConCredito({ bloqueado: true, credito_bloqueado: true }),
      ForbiddenException,
      "Cuenta bloqueada por el cliente",
    );
  });

  it("sin bloqueos pasa", () => {
    expect(() =>
      exigirClienteConCredito({ bloqueado: false, credito_bloqueado: false }),
    ).not.toThrow();
  });
});
