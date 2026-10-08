import { Injectable } from "@nestjs/common";
import puppeteer from "puppeteer";
import { SaldosService } from "../saldos.service";
import { QueryEstadoCuentaDto } from "../dto/query-estado-cuenta.dto";
import { buildEstadoCuentaHtml } from "./estado-cuenta-template";
import { opcionesChrome } from "../../../common/chrome";

@Injectable()
export class SaldosPdfService {
  constructor(private readonly saldos: SaldosService) {}

  async generarEstadoCuenta(
    clienteId: string,
    query: QueryEstadoCuentaDto,
  ): Promise<Buffer> {
    const estado = await this.saldos.getEstadoCuenta(clienteId, query);

    const html = buildEstadoCuentaHtml({
      cliente: { nombre: estado.cliente.nombre, nit: estado.cliente.nit },
      periodoLabel: this.periodoLabel(query),
      fechaGeneracion: new Date().toLocaleDateString("es-GT", {
        timeZone: "America/Guatemala",
        day: "2-digit",
        month: "long",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }),
      saldo_inicial: estado.saldo_inicial,
      total_abonos: estado.total_abonos,
      total_debitos: estado.total_debitos,
      saldo_final: estado.saldo_final,
      movimientos: estado.movimientos,
    });

    return this.renderPdf(html);
  }

  private periodoLabel(q: QueryEstadoCuentaDto): string {
    if (q.fecha_desde && q.fecha_hasta)
      return `${q.fecha_desde} — ${q.fecha_hasta}`;
    if (q.fecha_desde) return `Desde ${q.fecha_desde}`;
    if (q.fecha_hasta) return `Hasta ${q.fecha_hasta}`;
    return "Histórico completo";
  }

  /**
   * Mismo endurecimiento que ReportesPdfService, y por el mismo motivo: el HTML
   * lleva texto que viene de la base (nombre del cliente, descripción del
   * movimiento), así que un escape del renderer llegaría al host. El sandbox
   * se decide en common/chrome.ts.
   */
  private async renderPdf(html: string): Promise<Buffer> {
    const browser = await puppeteer.launch(opcionesChrome());
    try {
      const page = await browser.newPage();

      // El estado de cuenta es HTML+CSS estático: sin JS no hay superficie de
      // inyección vía atributos del template.
      await page.setJavaScriptEnabled(false);

      // La plantilla es autocontenida: cualquier petición de red sobra, y
      // bloquearlas corta exfiltración y SSRF si algo se colara en el HTML.
      await page.setRequestInterception(true);
      page.on("request", (req) => {
        const url = req.url();
        if (url.startsWith("data:") || url.startsWith("about:")) {
          return void req.continue();
        }
        void req.abort();
      });

      await page.setContent(html, { waitUntil: "load" });
      const pdf = await page.pdf({
        format: "A4",
        printBackground: true,
        margin: { top: "0", right: "0", bottom: "0", left: "0" },
      });
      return Buffer.from(pdf);
    } finally {
      await browser.close();
    }
  }
}
