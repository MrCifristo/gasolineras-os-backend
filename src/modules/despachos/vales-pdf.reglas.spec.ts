// src/modules/despachos/vales-pdf.reglas.spec.ts
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { esperarError } from "../../../test/unit/esperar-error";
import {
  deACuatro,
  exigirTopeVales,
  nombreArchivoVales,
  parsearIds,
} from "./vales-pdf.reglas";

describe("exigirTopeVales", () => {
  it("0 vales: 404", () => {
    esperarError(
      () => exigirTopeVales(0),
      NotFoundException,
      "No hay vales con esos filtros",
    );
  });

  it.each([1, 499, 500])("%i vales pasa", (n) => {
    expect(() => exigirTopeVales(n)).not.toThrow();
  });

  it("501 vales: 400 con el total real", () => {
    esperarError(
      () => exigirTopeVales(501),
      BadRequestException,
      "Son 501 vales; acota el período o los filtros (máximo 500 por PDF).",
    );
  });
});

describe("nombreArchivoVales", () => {
  it("un solo vale usa serie y número", () => {
    expect(
      nombreArchivoVales({
        cliente: null,
        unVale: { serie: "A", numero: "000123" },
      }),
    ).toBe("vale-A-000123.pdf");
  });

  it("cliente y rango: slug sin tildes", () => {
    expect(
      nombreArchivoVales({
        cliente: "Coca-Cola Ñandú, S.A.",
        desde: "2026-10-01",
        hasta: "2026-10-12",
      }),
    ).toBe("vales-coca-cola-nandu-s-a-2026-10-01-a-2026-10-12.pdf");
  });

  it("un nombre sin letras ni dígitos cae en todos", () => {
    expect(nombreArchivoVales({ cliente: "¿?" })).toBe(
      "vales-todos-inicio-a-hoy.pdf",
    );
  });

  it("sin cliente ni rango", () => {
    expect(nombreArchivoVales({ cliente: null })).toBe(
      "vales-todos-inicio-a-hoy.pdf",
    );
  });
});

describe("nombreArchivoVales con entradas hostiles", () => {
  const hostil = 'a"b;c\nd\r\né😀/..\\';
  const seguroRe = /^[A-Za-z0-9._-]+$/;

  it("cliente, desde y hasta hostiles: solo caracteres seguros", () => {
    const n = nombreArchivoVales({
      cliente: hostil,
      desde: hostil,
      hasta: hostil,
    });
    expect(n).toMatch(seguroRe);
    expect(n).toBe("vales-a-b-c-d-e-inicio-a-hoy.pdf");
  });

  it("fecha con formato ISO se conserva; otra cosa se descarta", () => {
    expect(
      nombreArchivoVales({
        cliente: null,
        desde: "2026-10-01",
        hasta: "2026-10-1x",
      }),
    ).toBe("vales-todos-2026-10-01-a-hoy.pdf");
  });

  it("serie y número hostiles: solo caracteres seguros", () => {
    const n = nombreArchivoVales({
      cliente: null,
      unVale: { serie: hostil, numero: '1"\n;😀' },
    });
    expect(n).toMatch(seguroRe);
    expect(n.startsWith("vale-")).toBe(true);
    expect(n.endsWith(".pdf")).toBe(true);
  });
});

describe("deACuatro", () => {
  it.each([
    [0, []],
    [4, [4]],
    [5, [4, 1]],
    [9, [4, 4, 1]],
  ])("%i elementos", (n, tamanios) => {
    const items = Array.from({ length: n }, (_, i) => i);
    const grupos = deACuatro(items);
    expect(grupos.map((g) => g.length)).toEqual(tamanios);
    expect(grupos.flat()).toEqual(items);
  });
});

describe("parsearIds", () => {
  const a = "3f2b8c1e-5d4a-4b6e-9c7d-1a2b3c4d5e6f";
  const b = "7a9e0f11-2b3c-4d5e-8f60-718293a4b5c6";

  it("undefined y vacío: undefined", () => {
    expect(parsearIds(undefined)).toBeUndefined();
    expect(parsearIds("")).toBeUndefined();
  });

  it("recorta y descarta vacíos", () => {
    expect(parsearIds(` ${a} , ${b} ,`)).toEqual([a, b]);
  });

  it("solo comas: undefined", () => {
    expect(parsearIds(" , ")).toBeUndefined();
  });

  it("un UUID inválido: 400", () => {
    esperarError(
      () => parsearIds(`${a},no-es-uuid`),
      BadRequestException,
      "ids debe ser una lista de UUID separados por comas",
    );
  });
});
