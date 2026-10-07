// src/modules/saldos/pdf/saldos-pdf.service.spec.ts
import puppeteer from "puppeteer";
import { SaldosService } from "../saldos.service";
import { SaldosPdfService } from "./saldos-pdf.service";

type PuppeteerMock = {
  __paginas: {
    jsHabilitado: boolean;
    interceptacionActiva: boolean;
    eventos: string[];
    html: string | null;
  }[];
  __limpiarPaginas: () => void;
};
const mock = puppeteer as unknown as PuppeteerMock;
const paginas = mock.__paginas;

const estado = {
  cliente: { nombre: "Distribuidora Caribe", nit: null },
  saldo_inicial: "0",
  total_abonos: "0",
  total_debitos: "0",
  saldo_final: "0",
  movimientos: [],
};

function armar() {
  const saldos = { getEstadoCuenta: jest.fn().mockResolvedValue(estado) };
  return new SaldosPdfService(saldos as unknown as SaldosService);
}

describe("SaldosPdfService", () => {
  beforeEach(() => mock.__limpiarPaginas());

  it("devuelve un buffer que empieza con %PDF-", async () => {
    const pdf = await armar().generarEstadoCuenta("c1", {});
    expect(Buffer.isBuffer(pdf)).toBe(true);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("deja la página con JS apagado, interceptación activa y un listener de request", async () => {
    await armar().generarEstadoCuenta("c1", {});
    expect(paginas).toHaveLength(1);
    expect(paginas[0].jsHabilitado).toBe(false);
    expect(paginas[0].interceptacionActiva).toBe(true);
    expect(paginas[0].eventos).toContain("request");
  });

  it.each([
    [
      { fecha_desde: "2026-10-01", fecha_hasta: "2026-10-07" },
      "2026-10-01 — 2026-10-07",
    ],
    [{ fecha_desde: "2026-10-01" }, "Desde 2026-10-01"],
    [{ fecha_hasta: "2026-10-07" }, "Hasta 2026-10-07"],
    [{}, "Histórico completo"],
  ])("el período %j se rotula «%s»", async (query, rotulo) => {
    await armar().generarEstadoCuenta("c1", query);
    expect(paginas[0].html).toContain(rotulo);
  });
});
