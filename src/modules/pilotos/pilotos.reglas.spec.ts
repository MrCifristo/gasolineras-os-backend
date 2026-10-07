// src/modules/pilotos/pilotos.reglas.spec.ts
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { esperarError } from "../../../test/unit/esperar-error";
import {
  clienteIdDeAlcancePiloto,
  clienteIdParaCrearPiloto,
  rechazarOtraEmpresaPiloto,
} from "./pilotos.reglas";

describe("clienteIdDeAlcancePiloto", () => {
  it("el admin no se acota", () => {
    expect(clienteIdDeAlcancePiloto({ rol: "admin" })).toBeNull();
  });

  it("el cliente queda acotado a su cliente_id", () => {
    expect(clienteIdDeAlcancePiloto({ rol: "cliente", cliente_id: "c1" })).toBe(
      "c1",
    );
  });

  it("sin cliente_id, fail-closed con 404", () => {
    esperarError(
      () => clienteIdDeAlcancePiloto({ rol: "cliente", cliente_id: null }),
      NotFoundException,
      "Piloto no encontrado",
    );
  });
});

describe("clienteIdParaCrearPiloto", () => {
  it("el cliente crea a su nombre, pisando el del body", () => {
    expect(
      clienteIdParaCrearPiloto({ rol: "cliente", cliente_id: "c1" }, "c2"),
    ).toBe("c1");
  });

  it("el admin usa el del body", () => {
    expect(clienteIdParaCrearPiloto({ rol: "admin" }, "c2")).toBe("c2");
  });

  it("el admin sin cliente_id recibe 400", () => {
    esperarError(
      () => clienteIdParaCrearPiloto({ rol: "admin" }),
      BadRequestException,
      "cliente_id es obligatorio",
    );
  });
});

describe("rechazarOtraEmpresaPiloto", () => {
  const cliente = { rol: "cliente", cliente_id: "c1" };

  it("el cliente no puede mover un piloto a otra empresa: 403", () => {
    esperarError(
      () => rechazarOtraEmpresaPiloto(cliente, "c2"),
      ForbiddenException,
      "No puede asignar el piloto a otra empresa",
    );
  });

  it("permite su empresa, el body sin cliente_id y al admin", () => {
    expect(() => rechazarOtraEmpresaPiloto(cliente, "c1")).not.toThrow();
    expect(() => rechazarOtraEmpresaPiloto(cliente, undefined)).not.toThrow();
    expect(() =>
      rechazarOtraEmpresaPiloto({ rol: "admin" }, "c2"),
    ).not.toThrow();
  });
});

describe("rechazarOtraEmpresaPiloto con null", () => {
  it("el cliente recibe 403", () => {
    esperarError(
      () =>
        rechazarOtraEmpresaPiloto({ rol: "cliente", cliente_id: "c1" }, null),
      ForbiddenException,
      "No puede asignar el piloto a otra empresa",
    );
  });

  it("el admin recibe 400", () => {
    esperarError(
      () => rechazarOtraEmpresaPiloto({ rol: "admin" }, null),
      BadRequestException,
      "cliente_id no puede ser nulo",
    );
  });
});
