interface KpiData {
  total_galones: string | null;
  total_monto: string | null;
  total_despachos: number | string | null;
  promedio_galones?: string | null;
}

interface TipoCombustible {
  tipo_combustible: string;
  total_galones: string | null;
  total_monto: string | null;
}

interface PorGasolinera {
  gasolinera_id: string;
  total_galones: string | null;
  total_monto: string | null;
}

// Los ids son nullable desde el vale multi-renglón: despachos.vehiculo_id y
// piloto_id pueden ser null. En la práctica estas filas vienen de un innerJoin
// y nunca traen null, pero el tipo lo refleja igual.
interface VehiculoRow {
  vehiculo_id: string | null;
  placa: string;
  marca: string | null;
  modelo: string | null;
  total_despachos: number | string | null;
  total_galones: string | null;
  total_monto: string | null;
}

interface PilotoRow {
  piloto_id: string | null;
  nombre_completo: string;
  codigo: string | null;
  total_despachos: number | string | null;
  total_galones: string | null;
  total_monto: string | null;
}

interface DespachoRow {
  id: string;
  numero_vale: string;
  despachado_at: Date | string | null;
  gasolinera_id: string;
  placa?: string | null;
  nombre_completo?: string | null;
  tipo_combustible?: string | null;
  galones: string | null;
  monto_total: string | null;
}

export interface PdfTemplateData {
  fechaGeneracion: string;
  periodoLabel: string;
  clienteNombre?: string;
  kpis: KpiData;
  porTipo: TipoCombustible[];
  porGasolinera: PorGasolinera[];
  vehiculos: VehiculoRow[];
  pilotos: PilotoRow[];
  despachos: DespachoRow[];
  totalDespachos: number;
  graficas: {
    donut?: string;
    linea?: string;
    vehiculos?: string;
    pilotos?: string;
  };
}

// Este HTML lo renderiza Puppeteer, así que todo string que venga de la base
// (nombres de cliente, placas, códigos de piloto) se escapa antes de entrar al
// markup. Los formateadores de abajo (fmt/fmtInt/fmtDate) ya devuelven números
// o fechas y no necesitan pasar por acá.
function esc(v: string | number | null | undefined): string {
  if (v == null) return "—";
  return String(v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function fmt(v: string | number | null | undefined, decimals = 2): string {
  if (v == null) return "—";
  const n = parseFloat(String(v));
  if (isNaN(n)) return "—";
  return n.toLocaleString("es-GT", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function fmtInt(v: string | number | null | undefined): string {
  if (v == null) return "—";
  const n = parseInt(String(v));
  if (isNaN(n)) return "—";
  return n.toLocaleString("es-GT");
}

function fmtDate(d: Date | string | null): string {
  if (!d) return "—";
  const dt = typeof d === "string" ? new Date(d) : d;
  return dt.toLocaleDateString("es-GT", {
    timeZone: "America/Guatemala", // presentación; el servidor corre en UTC
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const CSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 11px; color: #1e293b; background: #f8fafc; }

  .page { width: 210mm; min-height: 297mm; padding: 0; page-break-after: always; background: #fff; position: relative; display: flex; flex-direction: column; }
  .page:last-child { page-break-after: auto; }

  /* ── Header ── */
  .header { background: linear-gradient(135deg, #0f2044 0%, #1e3a8a 60%, #2563eb 100%); color: #fff; padding: 28px 32px 22px; }
  .header-top { display: flex; justify-content: space-between; align-items: flex-start; }
  .header-logo { font-size: 22px; font-weight: 800; letter-spacing: -0.5px; }
  .header-logo span { color: #93c5fd; }
  .header-meta { text-align: right; font-size: 10px; opacity: 0.85; line-height: 1.6; }
  .header-periodo { margin-top: 6px; font-size: 13px; font-weight: 600; color: #bfdbfe; }

  /* ── KPI Cards ── */
  .kpi-row { display: flex; gap: 12px; padding: 20px 32px 0; }
  .kpi-card { flex: 1; background: linear-gradient(135deg, #0f2044, #1e40af); color: #fff; border-radius: 10px; padding: 14px 16px; }
  .kpi-label { font-size: 9px; text-transform: uppercase; letter-spacing: 0.8px; color: #93c5fd; margin-bottom: 4px; }
  .kpi-value { font-size: 20px; font-weight: 800; color: #fff; line-height: 1; }
  .kpi-unit { font-size: 10px; color: #bfdbfe; margin-top: 2px; }

  /* ── Section headers ── */
  .section { padding: 16px 32px; flex: 1; }
  .section-title { font-size: 13px; font-weight: 700; color: #0f2044; border-bottom: 2px solid #2563eb; padding-bottom: 5px; margin-bottom: 12px; text-transform: uppercase; letter-spacing: 0.5px; }

  /* ── Tables ── */
  table { width: 100%; border-collapse: collapse; font-size: 10px; }
  thead tr { background: #1e3a8a; color: #fff; }
  thead th { padding: 7px 10px; text-align: left; font-weight: 600; letter-spacing: 0.3px; }
  thead th.right { text-align: right; }
  tbody tr:nth-child(even) { background: #f0f7ff; }
  tbody tr:hover { background: #dbeafe; }
  tbody td { padding: 6px 10px; border-bottom: 1px solid #e2e8f0; }
  tbody td.right { text-align: right; font-variant-numeric: tabular-nums; }
  tfoot tr { background: #0f2044; color: #fff; font-weight: 700; }
  tfoot td { padding: 7px 10px; }
  tfoot td.right { text-align: right; }

  /* ── Chart containers ── */
  .chart-img { max-width: 100%; border-radius: 8px; display: block; }
  .two-col { display: flex; gap: 20px; align-items: flex-start; }
  .two-col .chart-wrap { flex: 1.2; }
  .two-col .table-wrap { flex: 1; }
  .half-section { flex: 1; }

  /* ── Footer ── */
  .footer { background: #0f2044; color: #93c5fd; font-size: 9px; padding: 8px 32px; display: flex; justify-content: space-between; margin-top: auto; }

  /* ── Page 1 subtitle ── */
  .cover-subtitle { font-size: 15px; font-weight: 300; color: #bfdbfe; margin-top: 4px; }

  /* ── Tipo badge ── */
  .badge { display: inline-block; padding: 2px 7px; border-radius: 10px; font-size: 9px; font-weight: 600; text-transform: uppercase; }
  .badge-diesel   { background: #1e3a8a; color: #fff; }
  .badge-super    { background: #065f46; color: #fff; }
  .badge-regular  { background: #7c3aed; color: #fff; }
  .badge-gas_lp   { background: #92400e; color: #fff; }

  .note { font-size: 9px; color: #64748b; margin-top: 8px; font-style: italic; }
`;

function footer(page: number, total: number, fechaGen: string): string {
  return `<div class="footer">
    <span>GasFuel OS — Sistema de Gestión de Combustible</span>
    <span>Generado: ${esc(fechaGen)}</span>
    <span>Pág. ${page} de ${total}</span>
  </div>`;
}

function tipoBadge(tipo: string): string {
  return `<span class="badge badge-${esc(tipo)}">${esc(tipo)}</span>`;
}

// ─────────────────────────────────────────
// Página 1: Portada y KPIs ejecutivos
// ─────────────────────────────────────────
function page1(d: PdfTemplateData): string {
  const promedioGalones =
    d.kpis.total_despachos && d.kpis.total_galones
      ? fmt(
          parseFloat(String(d.kpis.total_galones)) /
            parseFloat(String(d.kpis.total_despachos)),
        )
      : "—";

  const gasolineraRows = d.porGasolinera
    .map(
      (g, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${esc(g.gasolinera_id)}</td>
      <td class="right">${fmt(g.total_galones)} gal</td>
      <td class="right">Q ${fmt(g.total_monto)}</td>
    </tr>`,
    )
    .join("");

  return `
  <div class="page">
    <div class="header">
      <div class="header-top">
        <div>
          <div class="header-logo">⛽ GASFUEL <span>OS</span></div>
          <div class="cover-subtitle">Reporte Ejecutivo de Combustible</div>
          ${d.clienteNombre ? `<div style="margin-top:6px;font-size:11px;color:#bfdbfe">Empresa: <strong>${esc(d.clienteNombre)}</strong></div>` : ""}
        </div>
        <div class="header-meta">
          <div>Período</div>
          <div style="font-size:12px;font-weight:700;color:#fff">${esc(d.periodoLabel)}</div>
          <div style="margin-top:6px">Generado el</div>
          <div>${esc(d.fechaGeneracion)}</div>
        </div>
      </div>
    </div>

    <div class="kpi-row">
      <div class="kpi-card">
        <div class="kpi-label">Total Galones</div>
        <div class="kpi-value">${fmt(d.kpis.total_galones, 0)}</div>
        <div class="kpi-unit">galones despachados</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Monto Total</div>
        <div class="kpi-value">Q ${fmt(d.kpis.total_monto, 2)}</div>
        <div class="kpi-unit">quetzales</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Despachos</div>
        <div class="kpi-value">${fmtInt(d.kpis.total_despachos)}</div>
        <div class="kpi-unit">operaciones registradas</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Promedio/Despacho</div>
        <div class="kpi-value">${promedioGalones}</div>
        <div class="kpi-unit">galones por despacho</div>
      </div>
    </div>

    <div class="section" style="margin-top:16px">
      <div class="section-title">Resumen por Gasolinera</div>
      <table>
        <thead><tr>
          <th>#</th><th>Gasolinera ID</th>
          <th class="right">Galones</th><th class="right">Monto</th>
        </tr></thead>
        <tbody>${gasolineraRows || '<tr><td colspan="4" style="text-align:center;color:#94a3b8">Sin datos</td></tr>'}</tbody>
      </table>
    </div>

    ${footer(1, 4, d.fechaGeneracion)}
  </div>`;
}

// ─────────────────────────────────────────
// Página 2: Análisis de Combustible
// ─────────────────────────────────────────
function page2(d: PdfTemplateData): string {
  const totalGal = parseFloat(String(d.kpis.total_galones || "0")) || 1;
  const totalMonto = parseFloat(String(d.kpis.total_monto || "0")) || 1;

  const tipoRows = d.porTipo
    .map((t) => {
      const gal = parseFloat(String(t.total_galones || "0"));
      const mon = parseFloat(String(t.total_monto || "0"));
      const pct = ((gal / totalGal) * 100).toFixed(1);
      return `<tr>
      <td>${tipoBadge(t.tipo_combustible)}</td>
      <td class="right">${fmt(t.total_galones)} gal</td>
      <td class="right">Q ${fmt(t.total_monto)}</td>
      <td class="right">${pct}%</td>
    </tr>`;
    })
    .join("");

  // GraficasDto ya obliga a que esto sea un data URL base64 válido; el esc()
  // es la segunda línea de defensa por si el template se llama desde otro lado.
  const donutSection = d.graficas.donut
    ? `<img class="chart-img" src="${esc(d.graficas.donut)}" alt="Distribución por tipo" />`
    : "";

  const lineaSection = d.graficas.linea
    ? `<div style="margin-top:16px"><div class="section-title">Tendencia Mensual (12 meses)</div><img class="chart-img" src="${esc(d.graficas.linea)}" alt="Tendencia mensual" /></div>`
    : "";

  return `
  <div class="page">
    <div class="header">
      <div class="header-top">
        <div><div class="header-logo">⛽ GASFUEL <span>OS</span></div></div>
        <div class="header-meta">
          <div>Análisis de Combustible</div>
          <div>${esc(d.periodoLabel)}</div>
        </div>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Distribución por Tipo de Combustible</div>
      <div class="two-col">
        ${d.graficas.donut ? `<div class="chart-wrap">${donutSection}</div>` : ""}
        <div class="${d.graficas.donut ? "table-wrap" : ""}" style="width:100%">
          <table>
            <thead><tr>
              <th>Tipo</th>
              <th class="right">Galones</th>
              <th class="right">Monto</th>
              <th class="right">%</th>
            </tr></thead>
            <tbody>${tipoRows || '<tr><td colspan="4" style="text-align:center;color:#94a3b8">Sin datos</td></tr>'}</tbody>
          </table>
        </div>
      </div>

      ${lineaSection}
    </div>

    ${footer(2, 4, d.fechaGeneracion)}
  </div>`;
}

// ─────────────────────────────────────────
// Página 3: Vehículos y Pilotos
// ─────────────────────────────────────────
function page3(d: PdfTemplateData): string {
  const vehiculoRows = d.vehiculos
    .slice(0, 10)
    .map(
      (v, i) => `<tr>
    <td>${i + 1}</td>
    <td><strong>${esc(v.placa)}</strong></td>
    <td>${esc(v.marca)} ${esc(v.modelo)}</td>
    <td class="right">${fmtInt(v.total_despachos)}</td>
    <td class="right">${fmt(v.total_galones)} gal</td>
    <td class="right">Q ${fmt(v.total_monto)}</td>
  </tr>`,
    )
    .join("");

  const pilotoRows = d.pilotos
    .slice(0, 10)
    .map(
      (p, i) => `<tr>
    <td>${i + 1}</td>
    <td>${esc(p.codigo)}</td>
    <td>${esc(p.nombre_completo)}</td>
    <td class="right">${fmtInt(p.total_despachos)}</td>
    <td class="right">${fmt(p.total_galones)} gal</td>
    <td class="right">Q ${fmt(p.total_monto)}</td>
  </tr>`,
    )
    .join("");

  return `
  <div class="page">
    <div class="header">
      <div class="header-top">
        <div><div class="header-logo">⛽ GASFUEL <span>OS</span></div></div>
        <div class="header-meta">
          <div>Vehículos y Pilotos</div>
          <div>${esc(d.periodoLabel)}</div>
        </div>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Top Vehículos por Consumo</div>
      <div style="display:flex;gap:16px;align-items:flex-start">
        ${d.graficas.vehiculos ? `<div style="flex:1"><img class="chart-img" src="${esc(d.graficas.vehiculos)}" alt="Top vehículos" /></div>` : ""}
        <div style="flex:${d.graficas.vehiculos ? "1.2" : "1"}">
          <table>
            <thead><tr>
              <th>#</th><th>Placa</th><th>Vehículo</th>
              <th class="right">Despachos</th><th class="right">Galones</th><th class="right">Monto</th>
            </tr></thead>
            <tbody>${vehiculoRows || '<tr><td colspan="6" style="text-align:center;color:#94a3b8">Sin datos</td></tr>'}</tbody>
          </table>
        </div>
      </div>

      <div style="margin-top:18px">
        <div class="section-title">Top Pilotos por Consumo</div>
        <div style="display:flex;gap:16px;align-items:flex-start">
          ${d.graficas.pilotos ? `<div style="flex:1"><img class="chart-img" src="${esc(d.graficas.pilotos)}" alt="Top pilotos" /></div>` : ""}
          <div style="flex:${d.graficas.pilotos ? "1.2" : "1"}">
            <table>
              <thead><tr>
                <th>#</th><th>Código</th><th>Piloto</th>
                <th class="right">Despachos</th><th class="right">Galones</th><th class="right">Monto</th>
              </tr></thead>
              <tbody>${pilotoRows || '<tr><td colspan="6" style="text-align:center;color:#94a3b8">Sin datos</td></tr>'}</tbody>
            </table>
          </div>
        </div>
      </div>
    </div>

    ${footer(3, 4, d.fechaGeneracion)}
  </div>`;
}

// ─────────────────────────────────────────
// Página 4: Consolidado de Despachos
// ─────────────────────────────────────────
function page4(d: PdfTemplateData): string {
  const shown = d.despachos.slice(0, 200);
  const overflow = d.totalDespachos - shown.length;

  const totalGalones = shown.reduce(
    (s, r) => s + parseFloat(String(r.galones || "0")),
    0,
  );
  const totalMonto = shown.reduce(
    (s, r) => s + parseFloat(String(r.monto_total || "0")),
    0,
  );

  const rows = shown
    .map(
      (r, i) => `<tr>
    <td>${i + 1}</td>
    <td><strong>${esc(r.numero_vale)}</strong></td>
    <td>${fmtDate(r.despachado_at)}</td>
    <td style="font-size:9px">${esc(r.gasolinera_id)}</td>
    <td>${esc(r.placa)}</td>
    <td>${esc(r.nombre_completo)}</td>
    <td>${r.tipo_combustible ? tipoBadge(r.tipo_combustible) : "—"}</td>
    <td class="right">${fmt(r.galones)}</td>
    <td class="right">Q ${fmt(r.monto_total)}</td>
  </tr>`,
    )
    .join("");

  return `
  <div class="page">
    <div class="header">
      <div class="header-top">
        <div><div class="header-logo">⛽ GASFUEL <span>OS</span></div></div>
        <div class="header-meta">
          <div>Consolidado de Despachos</div>
          <div>${esc(d.periodoLabel)}</div>
        </div>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Registro de Despachos (${fmtInt(d.totalDespachos)} total${d.totalDespachos !== 1 ? "es" : ""})</div>
      <table>
        <thead><tr>
          <th>#</th><th>Vale</th><th>Fecha/Hora</th><th>Gasolinera</th>
          <th>Placa</th><th>Piloto</th><th>Tipo</th>
          <th class="right">Galones</th><th class="right">Monto</th>
        </tr></thead>
        <tbody>${rows || '<tr><td colspan="9" style="text-align:center;color:#94a3b8;padding:20px">Sin despachos en el período</td></tr>'}</tbody>
        <tfoot><tr>
          <td colspan="7" style="font-size:10px">TOTALES (${shown.length} registros mostrados)</td>
          <td class="right">${fmt(totalGalones)} gal</td>
          <td class="right">Q ${fmt(totalMonto)}</td>
        </tr></tfoot>
      </table>
      ${overflow > 0 ? `<p class="note">* Se muestran los primeros 200 registros. Hay ${fmtInt(overflow)} despacho${overflow !== 1 ? "s" : ""} adicional${overflow !== 1 ? "es" : ""} no incluido${overflow !== 1 ? "s" : ""} en esta tabla.</p>` : ""}
    </div>

    ${footer(4, 4, d.fechaGeneracion)}
  </div>`;
}

export function buildPdfHtml(data: PdfTemplateData): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Reporte GasFuel OS</title>
  <style>${CSS}</style>
</head>
<body>
  ${page1(data)}
  ${page2(data)}
  ${page3(data)}
  ${page4(data)}
</body>
</html>`;
}
