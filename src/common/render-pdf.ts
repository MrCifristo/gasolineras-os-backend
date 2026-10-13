import puppeteer, { type PDFOptions } from "puppeteer";
import { opcionesChrome } from "./chrome";

/**
 * Renders de PDF a la vez en este proceso. Cada uno levanta su propio Chrome,
 * y varios lotes grandes en paralelo pueden agotar la memoria del contenedor y
 * tumbar con él los despachos de la bomba. Los demás esperan su turno.
 */
const MAX_RENDERS_SIMULTANEOS = 2;
let rendersEnCurso = 0;
const enEspera: (() => void)[] = [];

async function tomarTurno(): Promise<void> {
  if (rendersEnCurso < MAX_RENDERS_SIMULTANEOS) {
    rendersEnCurso++;
    return;
  }
  // Quien suelta su turno se lo pasa directo al primero de la fila, sin
  // descontar: así nadie que llegue después se cuela.
  await new Promise<void>((resolve) => enEspera.push(resolve));
}

function soltarTurno(): void {
  const siguiente = enEspera.shift();
  if (siguiente) siguiente();
  else rendersEnCurso--;
}

/**
 * HTML → PDF con Chrome, el render que comparten el reporte, el estado de
 * cuenta y los vales.
 *
 * Endurecido porque el HTML lleva texto de la base (nombres, descripciones) y
 * data: URLs (gráficas, firmas), así que un escape del renderer llegaría al
 * proceso que tiene DATABASE_URL y los secretos. El sandbox se decide en
 * common/chrome.ts.
 *
 * "Letter" (vales) deja mandar al `@page` de la plantilla; "A4" conserva las
 * opciones con las que siempre salieron el reporte y el estado de cuenta.
 * Como mucho corren MAX_RENDERS_SIMULTANEOS a la vez.
 */
export async function renderizarPdf(
  html: string,
  formato: "A4" | "Letter",
): Promise<Buffer> {
  await tomarTurno();
  try {
    return await render(html, formato);
  } finally {
    // También si Chrome no arranca o el render falla: si no, el lugar quedaría
    // tomado para siempre y los PDF siguientes esperarían sin fin.
    soltarTurno();
  }
}

async function render(html: string, formato: "A4" | "Letter"): Promise<Buffer> {
  const browser = await puppeteer.launch(opcionesChrome());
  try {
    const page = await browser.newPage();

    // Las plantillas son HTML+CSS estático: sin JS no hay superficie de
    // inyección vía atributos.
    await page.setJavaScriptEnabled(false);

    // Las plantillas son autocontenidas (sin fuentes, CDN ni scripts remotos):
    // about: es el documento base que abre setContent y data: son las imágenes
    // embebidas. Bloquear el resto corta exfiltración y SSRF aunque algo se
    // cuele en el HTML.
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const url = req.url();
      if (url.startsWith("data:") || url.startsWith("about:")) {
        return void req.continue();
      }
      void req.abort();
    });

    await page.setContent(html, { waitUntil: "load" });
    const opciones: PDFOptions = {
      format: formato,
      printBackground: true,
      ...(formato === "Letter" ? { preferCSSPageSize: true } : {}),
      margin: { top: "0", right: "0", bottom: "0", left: "0" },
    };
    const pdf = await page.pdf(opciones);
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}
