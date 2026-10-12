// src/modules/despachos/vales-pdf.template.spec.ts
import { buildValesHtml, ValePdf } from "./vales-pdf.template";

const PNG = "data:image/png;base64,iVBORw0KGgo=";

const vale = (parcial: Partial<ValePdf> = {}): ValePdf => ({
  serie_vale: "A",
  numero_vale: "000123",
  correlativo_cliente: 45,
  // 2026-10-12 02:30 UTC = 11 de octubre 20:30 en Guatemala
  despachado_at: "2026-10-12T02:30:00Z",
  turno: "tarde",
  bomba_numero: 1,
  gasolinera: { nombre: "La Estación Morales", ciudad: "Morales" },
  cliente: { nombre: "Distribuidora Caribe", nit: "1234567-8" },
  vehiculo: { placa: "P123ABC", marca: "Toyota", modelo: "Hilux" },
  piloto: { nombre_completo: "Juan Pérez" },
  kilometraje: "1500",
  renglones: [
    {
      renglon: "vehiculo",
      tipo_combustible: "diesel",
      galones: "10.000",
      precio_galon: "30.000",
      monto: "300.00",
    },
  ],
  monto_total: "300.00",
  galones: "10.000",
  operario: "Pedro Operario",
  despachador: "Ana Supervisora",
  firma: PNG,
  ...parcial,
});

const html = (vales: ValePdf[]) =>
  buildValesHtml({ vales, generadoEn: "12/10/2026 08:00" });

describe("buildValesHtml", () => {
  it("5 vales -> 2 hojas con 4 y 1 vale", () => {
    const out = html(Array.from({ length: 5 }, () => vale()));
    const hojas = out.split('<section class="hoja">').slice(1);
    expect(hojas).toHaveLength(2);
    expect(hojas[0].match(/<article class="vale">/g)).toHaveLength(4);
    expect(hojas[1].match(/<article class="vale">/g)).toHaveLength(1);
  });

  it("muestra serie-número, N° cliente y la hora de Guatemala", () => {
    const out = html([vale()]);
    expect(out).toContain("A-000123");
    expect(out).toContain("N° cliente 45");
    expect(out).toContain("11/10/2026");
    expect(out).toContain("20:30");
    expect(out).toContain("TARDE");
  });

  it("etiqueta el renglón de caneca y el combustible", () => {
    const out = html([
      vale({
        renglones: [
          {
            renglon: "caneca",
            tipo_combustible: "super",
            galones: "5.000",
            precio_galon: null,
            monto: "150.00",
          },
        ],
      }),
    ]);
    expect(out).toContain("CANECAS · GASOLINA SUPER");
  });

  it("sin firma muestra «Firma no disponible»", () => {
    expect(html([vale({ firma: null })])).toContain("Firma no disponible");
  });

  it("una firma que no es PNG en data-URL se trata como ausente", () => {
    const out = html([vale({ firma: 'javascript:alert(1)" onerror="x' })]);
    expect(out).toContain("Firma no disponible");
    expect(out).not.toContain("javascript:");
    expect(html([vale()])).toContain(`src="${PNG}"`);
  });

  it("escapa los datos con HTML", () => {
    const out = html([
      vale({
        cliente: { nombre: '<b>Ñ&"x"</b>', nit: null },
        operario: "<i>Op</i>",
      }),
    ]);
    expect(out).not.toContain("<b>Ñ");
    expect(out).toContain("&lt;b&gt;Ñ&amp;&quot;x&quot;&lt;/b&gt;");
    expect(out).not.toContain("<i>Op");
  });

  it("el pie es copia digital y nunca dice ORIGINAL", () => {
    const out = html([vale()]);
    expect(out).toContain("Copia digital — generada el 12/10/2026 08:00");
    expect(out).not.toMatch(/ORIGINAL/i);
  });

  it("el CSS fija carta y evita cortar un vale", () => {
    const out = html([vale()]);
    expect(out).toMatch(/@page\s*{[^}]*size:\s*letter/);
    expect(out).toMatch(/\.vale\s*{[^}]*break-inside:\s*avoid/);
  });

  it("la última hoja no fuerza salto de página (sin hoja en blanco)", () => {
    const out = html([vale()]);
    // el pie es hermano de las hojas: :last-child jamás coincidiría con una <section>
    expect(out).not.toContain(".hoja:last-child");
    expect(out).toMatch(/\.hoja:last-of-type\s*{[^}]*break-after:\s*auto/);
    // y es el único tipo <section> del body, así que la última hoja sí es last-of-type
    expect(out.match(/<section\b/g)).toHaveLength(1);
    expect(out.indexOf('class="pie"')).toBeGreaterThan(
      out.lastIndexOf("</section>"),
    );
  });

  it("tolera vehículo y piloto nulos", () => {
    const out = html([vale({ vehiculo: null, piloto: null })]);
    expect(out).toContain("A-000123");
  });
});
