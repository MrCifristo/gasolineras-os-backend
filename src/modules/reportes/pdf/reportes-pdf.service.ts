import { Injectable } from "@nestjs/common";
import puppeteer from "puppeteer";
import { and, eq, sql } from "drizzle-orm";
import { DbService } from "../../../db/db.service";
import {
  despachos,
  pilotos,
  preciosCombustible,
  vehiculos,
} from "../../../db/schema";
import { ReportesService, ReporteFilters } from "../reportes.service";
import { GenerarPdfDto } from "./reportes-pdf.dto";
import { buildPdfHtml, PdfTemplateData } from "./html-template";

@Injectable()
export class ReportesPdfService {
  constructor(
    private db: DbService,
    private reportesService: ReportesService,
  ) {}

  async generarPdf(dto: GenerarPdfDto, user: any): Promise<Buffer> {
    const filtros: ReporteFilters = { ...(dto.filtros ?? {}) };

    // Clientes solo pueden ver sus propios datos
    if (user.rol === "cliente") {
      filtros.cliente_id = user.cliente_id;
    }

    const [resumen, vehiculosData, pilotosData, despachosData] =
      await Promise.all([
        this.reportesService.resumen(filtros),
        this.reportesService.consumoPorVehiculo(filtros),
        this.reportesService.consumoPorPiloto(filtros),
        this.fetchDespachos(filtros),
      ]);

    const fechaGen = new Date().toLocaleDateString("es-GT", {
      day: "2-digit",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

    const periodoLabel = this.buildPeriodoLabel(filtros);

    const templateData: PdfTemplateData = {
      fechaGeneracion: fechaGen,
      periodoLabel,
      kpis: {
        total_galones: resumen.totales.total_galones,
        total_monto: resumen.totales.total_monto,
        total_despachos: resumen.totales.total_despachos,
      },
      porTipo: resumen.por_tipo_combustible,
      porGasolinera: resumen.por_gasolinera,
      vehiculos: vehiculosData,
      pilotos: pilotosData,
      despachos: despachosData.rows,
      totalDespachos: despachosData.total,
      graficas: {
        donut: dto.graficas?.donut,
        linea: dto.graficas?.linea,
        vehiculos: dto.graficas?.vehiculos,
        pilotos: dto.graficas?.pilotos,
      },
    };

    const html = buildPdfHtml(templateData);
    return this.renderPdf(html);
  }

  private async fetchDespachos(filtros: ReporteFilters) {
    const conditions: any[] = [];

    if (filtros.cliente_id)
      conditions.push(eq(despachos.cliente_id, filtros.cliente_id));
    if (filtros.gasolinera_id)
      conditions.push(eq(despachos.gasolinera_id, filtros.gasolinera_id));
    if (filtros.fecha_desde)
      conditions.push(
        sql`${despachos.despachado_at}::date >= ${filtros.fecha_desde}::date`,
      );
    if (filtros.fecha_hasta)
      conditions.push(
        sql`${despachos.despachado_at}::date <= ${filtros.fecha_hasta}::date`,
      );

    const where = conditions.length ? and(...conditions) : undefined;

    const rows = await this.db.db
      .select({
        id: despachos.id,
        numero_vale: despachos.numero_vale,
        despachado_at: despachos.despachado_at,
        gasolinera_id: despachos.gasolinera_id,
        galones: despachos.galones,
        monto_total: despachos.monto_total,
        placa: vehiculos.placa,
        nombre_completo: pilotos.nombre_completo,
        tipo_combustible: preciosCombustible.tipo_combustible,
      })
      .from(despachos)
      .leftJoin(vehiculos, eq(despachos.vehiculo_id, vehiculos.id))
      .leftJoin(pilotos, eq(despachos.piloto_id, pilotos.id))
      .leftJoin(
        preciosCombustible,
        eq(despachos.precio_id, preciosCombustible.id),
      )
      .where(where)
      .orderBy(sql`${despachos.despachado_at} DESC`);

    return { rows, total: rows.length };
  }

  private buildPeriodoLabel(filtros: ReporteFilters): string {
    if (filtros.fecha_desde && filtros.fecha_hasta) {
      return `${filtros.fecha_desde} — ${filtros.fecha_hasta}`;
    }
    if (filtros.fecha_desde) return `Desde ${filtros.fecha_desde}`;
    if (filtros.fecha_hasta) return `Hasta ${filtros.fecha_hasta}`;
    return "Todos los períodos";
  }

  private async renderPdf(html: string): Promise<Buffer> {
    const browser = await puppeteer.launch({
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
      headless: true,
    });
    try {
      const page = await browser.newPage();
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
