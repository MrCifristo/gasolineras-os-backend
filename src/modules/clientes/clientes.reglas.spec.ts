// src/modules/clientes/clientes.reglas.spec.ts
import { ConflictException } from "@nestjs/common";
import {
  claveNit,
  errorPorNitDuplicado,
  errorPorNitDuplicadoPg,
  normalizarNit,
} from "./clientes.reglas";

describe("normalizarNit", () => {
  it("guarda el NIT en mayúsculas y sin espacios en los extremos", () => {
    expect(normalizarNit(" 6935124-k ")).toBe("6935124-K");
  });

  it("deja pasar null y undefined sin tocarlos", () => {
    expect(normalizarNit(null)).toBeNull();
    expect(normalizarNit(undefined)).toBeUndefined();
  });
});

describe("claveNit", () => {
  it("compara sin mayúsculas ni guiones", () => {
    expect(claveNit("6935124-k")).toBe("6935124K");
    expect(claveNit("6935124K")).toBe("6935124K");
  });

  it("CF (consumidor final) no tiene clave: puede repetirse", () => {
    expect(claveNit("CF")).toBeNull();
    expect(claveNit("c-f")).toBeNull();
  });

  it("sin NIT no hay clave", () => {
    expect(claveNit(null)).toBeNull();
    expect(claveNit(undefined)).toBeNull();
    expect(claveNit("")).toBeNull();
    expect(claveNit("-")).toBeNull();
  });
});

describe("errorPorNitDuplicado", () => {
  it("con un cliente activo nombra a la empresa", () => {
    const e = errorPorNitDuplicado("4827319-5", {
      nombre: "Transportes Atlántico",
      activo: true,
    });
    expect(e).toBeInstanceOf(ConflictException);
    expect(e.message).toBe(
      "Ya existe un cliente con el NIT 4827319-5 (Transportes Atlántico).",
    );
  });

  it("con un cliente desactivado pide reactivarlo", () => {
    const e = errorPorNitDuplicado("4827319-5", {
      nombre: "Transportes Atlántico",
      activo: false,
    });
    expect(e.message).toBe(
      "El NIT 4827319-5 es de Transportes Atlántico, que está desactivado. Reactívalo desde la lista de clientes.",
    );
  });

  it("un nombre que termina en punto no duplica el punto", () => {
    const e = errorPorNitDuplicado("1", {
      nombre: "Caribe, S.A.",
      activo: true,
    });
    expect(e.message).toBe("Ya existe un cliente con el NIT 1 (Caribe, S.A.).");
  });

  it("activo null cuenta como activo (la columna admite null)", () => {
    const e = errorPorNitDuplicado("1", { nombre: "X", activo: null });
    expect(e.message).toBe("Ya existe un cliente con el NIT 1 (X).");
  });
});

describe("errorPorNitDuplicadoPg", () => {
  const violacion = (constraint: string) => ({
    cause: { code: "23505", constraint },
  });

  it("el 23505 del índice del NIT es 409", () => {
    const e = errorPorNitDuplicadoPg(violacion("clientes_nit_unico"));
    expect(e).toBeInstanceOf(ConflictException);
    expect((e as ConflictException).message).toBe(
      "Ya existe un cliente con ese NIT.",
    );
  });

  it("otro 23505 u otro error se devuelven tal cual", () => {
    const otro = violacion("otro_indice");
    expect(errorPorNitDuplicadoPg(otro)).toBe(otro);
    const cualquiera = new Error("x");
    expect(errorPorNitDuplicadoPg(cualquiera)).toBe(cualquiera);
  });
});
