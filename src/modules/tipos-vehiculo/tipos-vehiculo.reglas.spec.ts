// src/modules/tipos-vehiculo/tipos-vehiculo.reglas.spec.ts
import { BadRequestException, ConflictException } from "@nestjs/common";
import { esperarError } from "../../../test/unit/esperar-error";
import {
  errorPorTipoDuplicado,
  normalizarNombreTipo,
} from "./tipos-vehiculo.reglas";

describe("normalizarNombreTipo", () => {
  it("quita los espacios de los extremos y junta los repetidos", () => {
    expect(normalizarNombreTipo("  Camión   de  Carga ")).toBe(
      "Camión de Carga",
    );
  });

  it("un nombre vacío o sólo de espacios es 400", () => {
    esperarError(
      () => normalizarNombreTipo("   "),
      BadRequestException,
      "El nombre del tipo de vehículo es obligatorio",
    );
  });
});

describe("errorPorTipoDuplicado", () => {
  const violacion = (constraint: string) => ({
    cause: { code: "23505", constraint },
  });

  it("el 23505 del índice del nombre es 409 con el nombre", () => {
    const e = errorPorTipoDuplicado(
      violacion("tipos_vehiculo_nombre_unico"),
      "Motocicleta",
    );
    expect(e).toBeInstanceOf(ConflictException);
    expect((e as ConflictException).message).toBe(
      'Ya existe el tipo de vehículo "Motocicleta"',
    );
  });

  it("otro error se devuelve tal cual", () => {
    const otro = violacion("otro_indice");
    expect(errorPorTipoDuplicado(otro, "X")).toBe(otro);
    const cualquiera = new Error("x");
    expect(errorPorTipoDuplicado(cualquiera, "X")).toBe(cualquiera);
  });
});
