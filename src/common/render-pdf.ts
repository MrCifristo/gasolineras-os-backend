import puppeteer, { type PDFOptions } from "puppeteer";
import { opcionesChrome } from "./chrome";

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
 */
export async function renderizarPdf(
  html: string,
  formato: "A4" | "Letter",
): Promise<Buffer> {
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
