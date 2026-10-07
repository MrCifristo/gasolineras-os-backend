// src/modules/saldos/pdf/estado-cuenta-template.spec.ts
import {
  buildEstadoCuentaHtml,
  EstadoCuentaData,
} from "./estado-cuenta-template";

const base = (parcial: Partial<EstadoCuentaData> = {}): EstadoCuentaData => ({
  cliente: { nombre: "Distribuidora Caribe", nit: "1234567-8" },
  periodoLabel: "Histórico completo",
  fechaGeneracion: "07 de octubre de 2026",
  saldo_inicial: "100",
  total_abonos: "50",
  total_debitos: "31",
  saldo_final: "119",
  movimientos: [],
  ...parcial,
});

const saldosCorridos = (html: string) =>
  [...html.matchAll(/<td class="num strong">([^<]*)<\/td>/g)].map((m) => m[1]);

describe("buildEstadoCuentaHtml", () => {
  it("el saldo corrido sale de las celdas «num strong»", () => {
    const html = buildEstadoCuentaHtml(
      base({
        movimientos: [
          {
            created_at: "2026-10-01T15:00:00Z",
            tipo: "credito",
            descripcion: "Abono",
            monto: "50",
          },
          {
            created_at: "2026-10-02T15:00:00Z",
            tipo: "debito",
            descripcion: "Vale 1",
            monto: "30.5",
          },
          {
            created_at: "2026-10-03T15:00:00Z",
            tipo: "debito",
            descripcion: "Vale 2",
            monto: "0.5",
          },
        ],
      }),
    );
    expect(saldosCorridos(html)).toEqual(["150.00", "119.50", "119.00"]);
  });

  it("escapa <script> y comillas simples en el nombre y en la descripción", () => {
    const html = buildEstadoCuentaHtml(
      base({
        cliente: { nombre: "<script>alert(1)</script> O'Neil", nit: null },
        movimientos: [
          {
            created_at: null,
            tipo: "credito",
            descripcion: "<script>x</script>'",
            monto: "1",
          },
        ],
      }),
    );
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt; O&#39;Neil");
    expect(html).toContain("&lt;script&gt;x&lt;/script&gt;&#39;");
  });

  it("sin NIT no aparece «NIT»", () => {
    const html = buildEstadoCuentaHtml(
      base({ cliente: { nombre: "Transportes del Norte", nit: null } }),
    );
    expect(html).not.toContain("NIT");
  });

  it("con NIT lo imprime", () => {
    expect(buildEstadoCuentaHtml(base())).toContain("NIT 1234567-8");
  });

  it("sin movimientos muestra «Sin movimientos en el período»", () => {
    expect(buildEstadoCuentaHtml(base())).toContain(
      "Sin movimientos en el período",
    );
  });

  it("imprime la fecha en hora de Guatemala: 2026-10-08T03:00Z es 07/10/2026", () => {
    const html = buildEstadoCuentaHtml(
      base({
        movimientos: [
          {
            created_at: new Date("2026-10-08T03:00:00Z"),
            tipo: "credito",
            descripcion: "Abono",
            monto: "1",
          },
        ],
      }),
    );
    expect(html).toContain("<td>07/10/2026</td>");
  });
});
