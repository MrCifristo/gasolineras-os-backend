// src/common/render-pdf.spec.ts
import puppeteer from "puppeteer";
import { renderizarPdf } from "./render-pdf";

type SolicitudFalsa = {
  url: () => string;
  continue: jest.Mock;
  abort: jest.Mock;
};
type PuppeteerMock = {
  __paginas: {
    jsHabilitado: boolean;
    interceptacionActiva: boolean;
    manejadores: Record<string, (req: SolicitudFalsa) => void>;
    html: string | null;
    opcionesPdf: unknown;
  }[];
  __limpiarPaginas: () => void;
};
const mock = puppeteer as unknown as PuppeteerMock;
const paginas = mock.__paginas;

function solicitud(url: string): SolicitudFalsa {
  return { url: () => url, continue: jest.fn(), abort: jest.fn() };
}

const SIN_MARGEN = { top: "0", right: "0", bottom: "0", left: "0" };

describe("renderizarPdf", () => {
  beforeEach(() => mock.__limpiarPaginas());

  it("devuelve un buffer que empieza con %PDF- y carga el HTML dado", async () => {
    const pdf = await renderizarPdf("<p>hola</p>", "A4");
    expect(Buffer.isBuffer(pdf)).toBe(true);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(paginas[0].html).toBe("<p>hola</p>");
  });

  it("A4 conserva las opciones de siempre (sin preferCSSPageSize)", async () => {
    await renderizarPdf("<p></p>", "A4");
    expect(paginas[0].opcionesPdf).toEqual({
      format: "A4",
      printBackground: true,
      margin: SIN_MARGEN,
    });
  });

  it("Letter deja mandar al @page de la plantilla y va sin márgenes", async () => {
    await renderizarPdf("<p></p>", "Letter");
    expect(paginas[0].opcionesPdf).toEqual({
      format: "Letter",
      printBackground: true,
      preferCSSPageSize: true,
      margin: SIN_MARGEN,
    });
  });

  it("apaga JS y deja pasar sólo data: y about:", async () => {
    await renderizarPdf("<p></p>", "Letter");
    const [pagina] = paginas;
    expect(pagina.jsHabilitado).toBe(false);
    expect(pagina.interceptacionActiva).toBe(true);

    const manejar = pagina.manejadores.request;
    const permitidas = [
      solicitud("data:image/png;base64,AAAA"),
      solicitud("about:blank"),
    ];
    const bloqueadas = [
      solicitud("https://ejemplo.com/x.png"),
      solicitud("file:///etc/passwd"),
    ];
    for (const r of [...permitidas, ...bloqueadas]) manejar(r);

    for (const r of permitidas) {
      expect(r.continue).toHaveBeenCalled();
      expect(r.abort).not.toHaveBeenCalled();
    }
    for (const r of bloqueadas) {
      expect(r.abort).toHaveBeenCalled();
      expect(r.continue).not.toHaveBeenCalled();
    }
  });
});
