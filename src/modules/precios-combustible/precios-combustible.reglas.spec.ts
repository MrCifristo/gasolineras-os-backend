// src/modules/precios-combustible/precios-combustible.reglas.spec.ts
import { BadRequestException } from "@nestjs/common";
import { esperarError } from "../../../test/unit/esperar-error";
import { validarPrecioGalon } from "./precios-combustible.reglas";

describe("validarPrecioGalon", () => {
  it.each(["28.500", "0.001", "1"])("el precio %s pasa", (precio) => {
    expect(() => validarPrecioGalon(precio)).not.toThrow();
  });

  it.each(["0", "0.000", "-5", "abc", "", "0.0004", "0.0001"])(
    "el precio %p: 400",
    (precio) => {
      esperarError(
        () => validarPrecioGalon(precio),
        BadRequestException,
        "El precio por galón debe ser mayor a cero",
      );
    },
  );
});
