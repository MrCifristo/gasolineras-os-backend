// src/modules/saldos/saldos.reglas.spec.ts
import { BadRequestException } from "@nestjs/common";
import { esperarError } from "../../../test/unit/esperar-error";
import {
  resumenEstadoCuenta,
  validarCuadre,
  validarMontoAbono,
} from "./saldos.reglas";

describe("validarMontoAbono", () => {
  it("un monto positivo pasa", () => {
    expect(() => validarMontoAbono("100")).not.toThrow();
  });

  it.each(["0", "0.000", "-1"])("el monto %s: 400", (monto) => {
    esperarError(
      () => validarMontoAbono(monto),
      BadRequestException,
      "El monto debe ser mayor a cero",
    );
  });

  // HALLAZGO H5 (menor): un texto no numérico da NaN, y `NaN <= 0` es falso,
  // así que la regla lo deja pasar. Hoy lo frena `@IsNumberString` del DTO.
  it("HALLAZGO H5: un monto no numérico pasa la regla (lo frena el DTO)", () => {
    expect(() => validarMontoAbono("abc")).not.toThrow();
  });
});

describe("validarCuadre", () => {
  it("tipo cliente sin id: 400", () => {
    esperarError(
      () => validarCuadre({ tipo: "cliente" }),
      BadRequestException,
      'cliente_id es requerido cuando tipo es "cliente"',
    );
  });

  it("tipo cliente con id nulo: 400", () => {
    esperarError(
      () => validarCuadre({ tipo: "cliente", cliente_id: null }),
      BadRequestException,
      'cliente_id es requerido cuando tipo es "cliente"',
    );
  });

  it("tipo gasolinera pasa sin cliente_id", () => {
    expect(() => validarCuadre({ tipo: "gasolinera" })).not.toThrow();
  });

  it("tipo cliente con id pasa", () => {
    expect(() =>
      validarCuadre({ tipo: "cliente", cliente_id: "c-1" }),
    ).not.toThrow();
  });
});

describe("resumenEstadoCuenta", () => {
  it("suma abonos y débitos sobre el saldo previo", () => {
    expect(
      resumenEstadoCuenta("100.000", [
        { tipo: "credito", monto: "50" },
        { tipo: "debito", monto: "30.5" },
        { tipo: "debito", monto: "0.5" },
      ]),
    ).toEqual({
      saldo_inicial: "100.000",
      total_abonos: "50.000",
      total_debitos: "31.000",
      saldo_final: "119.000",
    });
  });

  it("sin saldo previo el inicial es 0.000", () => {
    expect(resumenEstadoCuenta(undefined, []).saldo_inicial).toBe("0.000");
    expect(resumenEstadoCuenta(null, []).saldo_inicial).toBe("0.000");
  });

  it("sin movimientos los totales son 0.000", () => {
    const r = resumenEstadoCuenta("10", []);
    expect(r.total_abonos).toBe("0.000");
    expect(r.total_debitos).toBe("0.000");
    expect(r.saldo_final).toBe("10.000");
  });

  it("un saldo previo negativo se arrastra", () => {
    const r = resumenEstadoCuenta("-20", [{ tipo: "credito", monto: "5" }]);
    expect(r.saldo_inicial).toBe("-20.000");
    expect(r.saldo_final).toBe("-15.000");
  });

  it("siempre se cumple inicial + abonos − débitos = final", () => {
    const r = resumenEstadoCuenta("-7.25", [
      { tipo: "credito", monto: "12.5" },
      { tipo: "debito", monto: "3.125" },
      { tipo: "credito", monto: "0.5" },
    ]);
    expect(
      parseFloat(r.saldo_inicial) +
        parseFloat(r.total_abonos) -
        parseFloat(r.total_debitos),
    ).toBeCloseTo(parseFloat(r.saldo_final), 3);
  });
});
