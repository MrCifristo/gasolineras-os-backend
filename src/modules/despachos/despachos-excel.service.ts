import { Injectable } from "@nestjs/common";
import ExcelJS from "exceljs";
import { and, eq, sql } from "drizzle-orm";
import { DbService } from "../../db/db.service";
import {
  despachos,
  vehiculos,
  pilotos,
  gasolineras,
  clientes,
  preciosCombustible,
} from "../../db/schema";
import { DespachoFilters } from "./despachos.service";

// Corporate Blue palette
const NAVY = "0F2044";
const BLUE = "2563EB";
const LIGHT = "DBEAFE";
const WHITE = "FFFFFF";
const GRAY = "F8FAFC";
const TEXT = "1E293B";

@Injectable()
export class DespachosExcelService {
  constructor(private db: DbService) {}

  async exportXlsx(filters: DespachoFilters, user: any): Promise<Buffer> {
    const rows = await this.fetchRows(filters, user);
    return this.buildWorkbook(rows, filters);
  }

  private async fetchRows(filters: DespachoFilters, user: any) {
    const conditions: any[] = [];

    if (user.rol === "operario")
      conditions.push(eq(despachos.gasolinera_id, user.gasolinera_id));
    if (user.rol === "cliente")
      conditions.push(eq(despachos.cliente_id, user.cliente_id));

    if (filters.gasolinera_id)
      conditions.push(eq(despachos.gasolinera_id, filters.gasolinera_id));
    if (filters.cliente_id)
      conditions.push(eq(despachos.cliente_id, filters.cliente_id));
    if (filters.vehiculo_id)
      conditions.push(eq(despachos.vehiculo_id, filters.vehiculo_id));
    if (filters.piloto_id)
      conditions.push(eq(despachos.piloto_id, filters.piloto_id));
    if (filters.turno) conditions.push(eq(despachos.turno, filters.turno));
    if (filters.tipo_combustible) {
      conditions.push(
        sql`${despachos.precio_id} IN (
          SELECT id FROM precios_combustible WHERE tipo_combustible = ${filters.tipo_combustible}
        )`,
      );
    }
    if (filters.fecha_desde)
      conditions.push(
        sql`${despachos.despachado_at}::date >= ${filters.fecha_desde}::date`,
      );
    if (filters.fecha_hasta)
      conditions.push(
        sql`${despachos.despachado_at}::date <= ${filters.fecha_hasta}::date`,
      );

    return this.db.db
      .select({
        numero_vale: despachos.numero_vale,
        serie_vale: despachos.serie_vale,
        despachado_at: despachos.despachado_at,
        turno: despachos.turno,
        bomba_numero: despachos.bomba_numero,
        galones: despachos.galones,
        monto_total: despachos.monto_total,
        kilometraje: despachos.kilometraje,
        gasolinera: gasolineras.nombre,
        cliente: clientes.nombre,
        placa: vehiculos.placa,
        marca: vehiculos.marca,
        modelo: vehiculos.modelo,
        piloto: pilotos.nombre_completo,
        codigo_piloto: pilotos.codigo,
        tipo_combustible: preciosCombustible.tipo_combustible,
        precio_galon: preciosCombustible.precio_galon,
      })
      .from(despachos)
      .innerJoin(gasolineras, eq(despachos.gasolinera_id, gasolineras.id))
      .innerJoin(clientes, eq(despachos.cliente_id, clientes.id))
      .innerJoin(vehiculos, eq(despachos.vehiculo_id, vehiculos.id))
      .innerJoin(pilotos, eq(despachos.piloto_id, pilotos.id))
      .innerJoin(
        preciosCombustible,
        eq(despachos.precio_id, preciosCombustible.id),
      )
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(sql`${despachos.despachado_at} DESC`);
  }

  private async buildWorkbook(
    rows: Awaited<ReturnType<DespachosExcelService["fetchRows"]>>,
    filters: DespachoFilters,
  ): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    wb.creator = "GasFuel OS";
    wb.created = new Date();

    this.addDespachosSheet(wb, rows);
    this.addResumenSheet(wb, rows);
    this.addFiltrosSheet(wb, filters);

    const buf = await wb.xlsx.writeBuffer();
    return Buffer.from(buf);
  }

  // ─── Hoja 1: Despachos ──────────────────────────────────────────
  private addDespachosSheet(
    wb: ExcelJS.Workbook,
    rows: Awaited<ReturnType<DespachosExcelService["fetchRows"]>>,
  ) {
    const ws = wb.addWorksheet("Despachos", {
      views: [{ state: "frozen", ySplit: 3 }],
    });

    // Título
    ws.mergeCells("A1:S1");
    const title = ws.getCell("A1");
    title.value = "⛽  GasFuel OS — Reporte de Despachos";
    title.font = {
      name: "Calibri",
      size: 14,
      bold: true,
      color: { argb: `FF${WHITE}` },
    };
    title.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: `FF${NAVY}` },
    };
    title.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
    ws.getRow(1).height = 30;

    // Subtítulo con fecha de generación
    ws.mergeCells("A2:S2");
    const sub = ws.getCell("A2");
    sub.value = `Generado el ${new Date().toLocaleString("es-GT", { dateStyle: "long", timeStyle: "short" })}   ·   ${rows.length} registro${rows.length !== 1 ? "s" : ""}`;
    sub.font = {
      name: "Calibri",
      size: 10,
      italic: true,
      color: { argb: `FF${WHITE}` },
    };
    sub.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: `FF${BLUE}` },
    };
    sub.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
    ws.getRow(2).height = 18;

    // Cabeceras
    const COLS: {
      header: string;
      key: string;
      width: number;
      numFmt?: string;
    }[] = [
      { header: "N° Vale", key: "numero_vale", width: 12 },
      { header: "Serie", key: "serie_vale", width: 10 },
      {
        header: "Fecha",
        key: "despachado_at",
        width: 14,
        numFmt: "DD/MM/YYYY",
      },
      {
        header: "Hora",
        key: "hora_despacho",
        width: 8,
        numFmt: "HH:mm",
      },
      { header: "Turno", key: "turno", width: 10 },
      { header: "Bomba", key: "bomba_numero", width: 8 },
      { header: "Gasolinera", key: "gasolinera", width: 22 },
      { header: "Cliente", key: "cliente", width: 22 },
      { header: "Placa", key: "placa", width: 10 },
      { header: "Vehículo", key: "vehiculo", width: 20 },
      { header: "Cód. Piloto", key: "codigo_piloto", width: 12 },
      { header: "Piloto", key: "piloto", width: 24 },
      { header: "Tipo Combustible", key: "tipo_combustible", width: 16 },
      {
        header: "Precio/Gal (Q)",
        key: "precio_galon",
        width: 14,
        numFmt: '"Q"#,##0.000',
      },
      { header: "Galones", key: "galones", width: 12, numFmt: "#,##0.000" },
      {
        header: "Monto (Q)",
        key: "monto_total",
        width: 14,
        numFmt: '"Q"#,##0.000',
      },
      {
        header: "Kilometraje",
        key: "kilometraje",
        width: 13,
        numFmt: "#,##0.000",
      },
    ];

    ws.columns = COLS.map((c) => ({ key: c.key, width: c.width }));

    const headerRow = ws.getRow(3);
    COLS.forEach((col, i) => {
      const cell = headerRow.getCell(i + 1);
      cell.value = col.header;
      cell.font = {
        name: "Calibri",
        size: 10,
        bold: true,
        color: { argb: `FF${WHITE}` },
      };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: `FF1E3A8A` },
      };
      cell.alignment = {
        vertical: "middle",
        horizontal: "center",
        wrapText: false,
      };
      cell.border = {
        bottom: { style: "medium", color: { argb: `FF${BLUE}` } },
      };
    });
    headerRow.height = 22;

    // Filas de datos
    rows.forEach((r, idx) => {
      const gtDate = r.despachado_at
        ? new Date(new Date(r.despachado_at).getTime() - 6 * 3600 * 1000)
        : null;
      const row = ws.addRow({
        numero_vale: r.numero_vale,
        serie_vale: r.serie_vale,
        despachado_at: gtDate,
        hora_despacho: gtDate,
        turno: r.turno,
        bomba_numero: r.bomba_numero,
        gasolinera: r.gasolinera,
        cliente: r.cliente,
        placa: r.placa,
        vehiculo: `${r.marca ?? ""} ${r.modelo ?? ""}`.trim(),
        codigo_piloto: r.codigo_piloto,
        piloto: r.piloto,
        tipo_combustible: r.tipo_combustible,
        precio_galon:
          r.precio_galon != null ? parseFloat(String(r.precio_galon)) : null,
        galones: r.galones != null ? parseFloat(String(r.galones)) : null,
        monto_total:
          r.monto_total != null ? parseFloat(String(r.monto_total)) : null,
        kilometraje:
          r.kilometraje != null ? parseFloat(String(r.kilometraje)) : null,
      });

      // Zebra striping
      const bg = idx % 2 === 0 ? WHITE : "EFF6FF";
      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: `FF${bg}` },
        };
        cell.font = { name: "Calibri", size: 10, color: { argb: `FF${TEXT}` } };
        cell.border = {
          bottom: { style: "hair", color: { argb: "FFE2E8F0" } },
        };
      });

      // Aplicar numFmt a celdas numéricas
      COLS.forEach((col, ci) => {
        if (col.numFmt) {
          row.getCell(ci + 1).numFmt = col.numFmt;
        }
      });

      // Resaltar tipo de combustible con color
      const tipoCell = row.getCell("tipo_combustible");
      const tipo = String(r.tipo_combustible ?? "");
      const tipoColors: Record<string, string> = {
        diesel: "1E3A8A",
        super: "065F46",
        regular: "7C3AED",
        gas_lp: "92400E",
      };
      if (tipoColors[tipo]) {
        tipoCell.font = {
          name: "Calibri",
          size: 10,
          bold: true,
          color: { argb: `FF${WHITE}` },
        };
        tipoCell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: `FF${tipoColors[tipo]}` },
        };
        tipoCell.alignment = { horizontal: "center" };
      }

      row.height = 16;
    });

    // Fila de totales
    if (rows.length > 0) {
      const totalRow = ws.addRow({
        numero_vale: "TOTALES",
        galones: rows.reduce(
          (s, r) => s + parseFloat(String(r.galones ?? "0")),
          0,
        ),
        monto_total: rows.reduce(
          (s, r) => s + parseFloat(String(r.monto_total ?? "0")),
          0,
        ),
      });
      totalRow.eachCell({ includeEmpty: true }, (cell) => {
        cell.font = {
          name: "Calibri",
          size: 10,
          bold: true,
          color: { argb: `FF${WHITE}` },
        };
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: `FF${NAVY}` },
        };
      });
      totalRow.getCell("galones").numFmt = "#,##0.000";
      totalRow.getCell("monto_total").numFmt = '"Q"#,##0.000';
      totalRow.height = 18;
    }

    // Auto-filtro en cabeceras
    ws.autoFilter = {
      from: { row: 3, column: 1 },
      to: { row: 3, column: COLS.length },
    };
  }

  // ─── Hoja 2: Resumen ────────────────────────────────────────────
  private addResumenSheet(
    wb: ExcelJS.Workbook,
    rows: Awaited<ReturnType<DespachosExcelService["fetchRows"]>>,
  ) {
    const ws = wb.addWorksheet("Resumen");

    const totalGalones = rows.reduce(
      (s, r) => s + parseFloat(String(r.galones ?? "0")),
      0,
    );
    const totalMonto = rows.reduce(
      (s, r) => s + parseFloat(String(r.monto_total ?? "0")),
      0,
    );
    const totalDesps = rows.length;

    // KPI block
    const kpis = [
      ["Total Despachos", totalDesps, "0"],
      ["Total Galones", totalGalones, "#,##0.000"],
      ["Monto Total (Q)", totalMonto, '"Q"#,##0.000'],
      [
        "Promedio Gal/Desp",
        totalDesps ? totalGalones / totalDesps : 0,
        "#,##0.000",
      ],
    ];

    ws.mergeCells("A1:C1");
    const hdr = ws.getCell("A1");
    hdr.value = "Resumen Ejecutivo";
    hdr.font = {
      name: "Calibri",
      size: 13,
      bold: true,
      color: { argb: `FF${WHITE}` },
    };
    hdr.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: `FF${NAVY}` },
    };
    hdr.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
    ws.getRow(1).height = 26;

    kpis.forEach(([label, value, fmt], i) => {
      const row = ws.getRow(i + 2);
      const labelCell = row.getCell(1);
      const valueCell = row.getCell(2);

      labelCell.value = label;
      labelCell.font = {
        name: "Calibri",
        size: 11,
        bold: true,
        color: { argb: `FF${NAVY}` },
      };
      labelCell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: `FF${LIGHT}` },
      };
      labelCell.alignment = { indent: 1, vertical: "middle" };

      valueCell.value = value;
      valueCell.numFmt = fmt as string;
      valueCell.font = {
        name: "Calibri",
        size: 12,
        bold: true,
        color: { argb: `FF${BLUE}` },
      };
      valueCell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: `FF${WHITE}` },
      };
      valueCell.alignment = { horizontal: "right", vertical: "middle" };
      row.height = 22;
    });

    ws.getColumn(1).width = 26;
    ws.getColumn(2).width = 20;

    // Tabla por tipo de combustible
    const byTipo = new Map<
      string,
      { galones: number; monto: number; count: number }
    >();
    rows.forEach((r) => {
      const t = r.tipo_combustible ?? "desconocido";
      const cur = byTipo.get(t) ?? { galones: 0, monto: 0, count: 0 };
      cur.galones += parseFloat(String(r.galones ?? "0"));
      cur.monto += parseFloat(String(r.monto_total ?? "0"));
      cur.count++;
      byTipo.set(t, cur);
    });

    const startRow = kpis.length + 3;
    ws.mergeCells(`A${startRow}:D${startRow}`);
    const th = ws.getCell(`A${startRow}`);
    th.value = "Desglose por Tipo de Combustible";
    th.font = {
      name: "Calibri",
      size: 11,
      bold: true,
      color: { argb: `FF${WHITE}` },
    };
    th.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: `FF1E3A8A` },
    };
    th.alignment = { indent: 1, vertical: "middle" };
    ws.getRow(startRow).height = 20;

    const colHeaders = ["Tipo", "Despachos", "Galones", "Monto (Q)"];
    const chRow = ws.getRow(startRow + 1);
    colHeaders.forEach((h, i) => {
      const c = chRow.getCell(i + 1);
      c.value = h;
      c.font = {
        name: "Calibri",
        size: 10,
        bold: true,
        color: { argb: `FF${WHITE}` },
      };
      c.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: `FF${NAVY}` },
      };
      c.alignment = { horizontal: "center" };
    });

    let ri = startRow + 2;
    byTipo.forEach((v, tipo) => {
      const row = ws.getRow(ri++);
      row.getCell(1).value = tipo;
      row.getCell(2).value = v.count;
      row.getCell(3).value = v.galones;
      row.getCell(3).numFmt = "#,##0.000";
      row.getCell(4).value = v.monto;
      row.getCell(4).numFmt = '"Q"#,##0.000';
      row.eachCell({ includeEmpty: true }, (c) => {
        c.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: `FF${ri % 2 === 0 ? WHITE : "EFF6FF"}` },
        };
        c.font = { name: "Calibri", size: 10 };
        c.border = { bottom: { style: "hair", color: { argb: "FFE2E8F0" } } };
      });
    });

    ws.getColumn(3).width = 16;
    ws.getColumn(4).width = 18;
  }

  // ─── Hoja 3: Filtros aplicados ──────────────────────────────────
  private addFiltrosSheet(wb: ExcelJS.Workbook, filters: DespachoFilters) {
    const ws = wb.addWorksheet("Filtros Aplicados");

    ws.mergeCells("A1:B1");
    const hdr = ws.getCell("A1");
    hdr.value = "Filtros aplicados en este reporte";
    hdr.font = {
      name: "Calibri",
      size: 12,
      bold: true,
      color: { argb: `FF${WHITE}` },
    };
    hdr.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: `FF${NAVY}` },
    };
    hdr.alignment = { indent: 1, vertical: "middle" };
    ws.getRow(1).height = 24;

    const entries: [string, string][] = [
      ["Cliente ID", filters.cliente_id ?? "(todos)"],
      ["Gasolinera ID", filters.gasolinera_id ?? "(todas)"],
      ["Vehículo ID", filters.vehiculo_id ?? "(todos)"],
      ["Piloto ID", filters.piloto_id ?? "(todos)"],
      ["Fecha desde", filters.fecha_desde ?? "(sin límite)"],
      ["Fecha hasta", filters.fecha_hasta ?? "(sin límite)"],
      ["Turno", filters.turno ?? "(todos)"],
      ["Tipo combustible", filters.tipo_combustible ?? "(todos)"],
    ];

    entries.forEach(([label, value], i) => {
      const row = ws.getRow(i + 2);
      const lc = row.getCell(1);
      const vc = row.getCell(2);
      lc.value = label;
      lc.font = { name: "Calibri", size: 10, bold: true };
      lc.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: `FF${LIGHT}` },
      };
      lc.alignment = { indent: 1 };
      vc.value = value;
      vc.font = { name: "Calibri", size: 10 };
      vc.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: `FF${WHITE}` },
      };
      vc.alignment = { indent: 1 };
      row.height = 18;
    });

    ws.getColumn(1).width = 22;
    ws.getColumn(2).width = 36;
  }
}
