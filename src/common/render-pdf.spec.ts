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

  describe("de a dos a la vez", () => {
    type Diferido = { resolver: () => void; rechazar: (e: Error) => void };
    let enVuelo: number;
    let maximo: number;
    let pdfs: Diferido[];

    // Cada render queda colgado en page.pdf hasta que la prueba lo suelte.
    function chromeLento() {
      enVuelo = 0;
      maximo = 0;
      pdfs = [];
      return jest.spyOn(puppeteer, "launch").mockImplementation(() => {
        enVuelo++;
        maximo = Math.max(maximo, enVuelo);
        const pagina = {
          setJavaScriptEnabled: () => Promise.resolve(),
          setRequestInterception: () => Promise.resolve(),
          on: () => undefined,
          setContent: () => Promise.resolve(),
          pdf: () =>
            new Promise<Uint8Array>((resolve, reject) => {
              pdfs.push({
                resolver: () => resolve(Buffer.from("%PDF-")),
                rechazar: reject,
              });
            }),
        };
        const navegador = {
          newPage: () => Promise.resolve(pagina),
          close: () => {
            enVuelo--;
            return Promise.resolve();
          },
        };
        return Promise.resolve(
          navegador as unknown as Awaited<ReturnType<typeof puppeteer.launch>>,
        );
      });
    }
    const vaciarCola = async () => {
      for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
    };

    // launch ya es un jest.fn del mock: spyOn devuelve ese mismo fn, así que
    // se limpian sus llamadas y se repone su implementación al terminar.
    const launchMock = jest.spyOn(puppeteer, "launch");
    const implementacionOriginal = launchMock.getMockImplementation();
    beforeEach(() => launchMock.mockClear());
    afterEach(() => {
      if (implementacionOriginal) {
        launchMock.mockImplementation(implementacionOriginal);
      }
    });

    it("con 3 a la vez, el tercero espera a que termine uno", async () => {
      const launch = chromeLento();
      const renders = [1, 2, 3].map(() => renderizarPdf("<p></p>", "A4"));
      await vaciarCola();
      expect(launch).toHaveBeenCalledTimes(2);

      pdfs[0].resolver();
      await renders[0];
      await vaciarCola();
      expect(launch).toHaveBeenCalledTimes(3);

      pdfs[1].resolver();
      pdfs[2].resolver();
      await Promise.all(renders);
      expect(maximo).toBe(2);
      expect(enVuelo).toBe(0);
    });

    it("un render que falla libera su lugar", async () => {
      const launch = chromeLento();
      const renders = [1, 2, 3].map(() =>
        renderizarPdf("<p></p>", "Letter").catch((e: Error) => e.message),
      );
      await vaciarCola();
      expect(launch).toHaveBeenCalledTimes(2);

      pdfs[0].rechazar(new Error("Chrome se cayó"));
      await expect(renders[0]).resolves.toBe("Chrome se cayó");
      await vaciarCola();
      expect(launch).toHaveBeenCalledTimes(3);

      pdfs[1].resolver();
      pdfs[2].resolver();
      await Promise.all(renders);
      expect(maximo).toBe(2);
    });

    it("si Chrome no arranca, también libera su lugar", async () => {
      const launch = jest
        .spyOn(puppeteer, "launch")
        .mockRejectedValue(new Error("sin memoria"));
      const resultados = await Promise.allSettled(
        [1, 2, 3, 4].map(() => renderizarPdf("<p></p>", "A4")),
      );
      expect(resultados.every((r) => r.status === "rejected")).toBe(true);
      expect(launch).toHaveBeenCalledTimes(4);
    });
  });
});
