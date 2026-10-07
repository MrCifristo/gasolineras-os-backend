// src/modules/reportes/pdf/html-template.spec.ts
import { buildPdfHtml, PdfTemplateData } from "./html-template";

const base = (parcial: Partial<PdfTemplateData> = {}): PdfTemplateData => ({
  fechaGeneracion: "07 de octubre de 2026",
  periodoLabel: "Todos los períodos",
  kpis: { total_galones: "10", total_monto: "100", total_despachos: 1 },
  porTipo: [],
  porGasolinera: [],
  vehiculos: [],
  pilotos: [],
  despachos: [],
  totalDespachos: 0,
  graficas: {},
  ...parcial,
});

describe("buildPdfHtml", () => {
  it("escapa una placa con <img onerror>", () => {
    const html = buildPdfHtml(
      base({
        vehiculos: [
          {
            vehiculo_id: "v1",
            placa: "<img src=x onerror=alert(1)>",
            marca: null,
            modelo: null,
            total_despachos: 1,
            total_galones: "1",
            total_monto: "1",
          },
        ],
      }),
    );
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  it("escapa el nombre del cliente y el período", () => {
    const html = buildPdfHtml(
      base({
        clienteNombre: "<b>Coca</b>",
        periodoLabel: "<i>hoy</i>",
      }),
    );
    expect(html).not.toContain("<b>Coca</b>");
    expect(html).not.toContain("<i>hoy</i>");
    expect(html).toContain("&lt;b&gt;Coca&lt;/b&gt;");
    expect(html).toContain("&lt;i&gt;hoy&lt;/i&gt;");
  });

  it("sin gráficas no hay chart-img", () => {
    // La clase aparece en el CSS; se busca el elemento <img>.
    expect(buildPdfHtml(base())).not.toContain('<img class="chart-img"');
  });

  it("con la gráfica donut el data URL va en el src", () => {
    const url = "data:image/png;base64,AAAA";
    const html = buildPdfHtml(base({ graficas: { donut: url } }));
    expect(html).toContain(`<img class="chart-img" src="${url}"`);
  });
});
