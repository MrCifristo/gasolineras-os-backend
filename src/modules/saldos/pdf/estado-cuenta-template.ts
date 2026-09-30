/**
 * Plantilla del estado de cuenta. Autocontenida a propósito: sin fuentes
 * remotas, sin CDN, sin scripts. El renderer corre con JS apagado y con toda
 * petición de red bloqueada, así que cualquier recurso externo simplemente no
 * cargaría — y ese es el punto.
 */

export interface MovimientoEstadoCuenta {
  created_at: Date | string | null;
  tipo: string;
  descripcion: string | null;
  monto: string;
}

export interface EstadoCuentaData {
  cliente: { nombre: string; nit: string | null };
  periodoLabel: string;
  fechaGeneracion: string;
  saldo_inicial: string;
  total_abonos: string;
  total_debitos: string;
  saldo_final: string;
  movimientos: MovimientoEstadoCuenta[];
}

// Todo string que venga de la base pasa por acá antes de entrar al markup: el
// nombre del cliente y la descripción del movimiento son texto libre.
function esc(v: string | number | null | undefined): string {
  if (v == null) return "—";
  return String(v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function q(v: string | number | null | undefined): string {
  if (v == null) return "—";
  const n = parseFloat(String(v));
  if (isNaN(n)) return "—";
  return n.toLocaleString("es-GT", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fecha(d: Date | string | null): string {
  if (!d) return "—";
  const dt = typeof d === "string" ? new Date(d) : d;
  return dt.toLocaleDateString("es-GT", {
    timeZone: "America/Guatemala", // presentación; el servidor corre en UTC
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export function buildEstadoCuentaHtml(d: EstadoCuentaData): string {
  // Se lleva el saldo corriente fila por fila: un estado de cuenta sin la
  // columna de saldo obliga a sumar a mano para verificar cualquier renglón.
  let corriente = parseFloat(d.saldo_inicial);
  const filas = d.movimientos
    .map((m) => {
      const monto = parseFloat(m.monto);
      const esCredito = m.tipo === "credito";
      corriente += esCredito ? monto : -monto;
      return `
      <tr>
        <td>${fecha(m.created_at)}</td>
        <td>${esc(m.descripcion)}</td>
        <td class="num">${esCredito ? q(monto) : ""}</td>
        <td class="num">${esCredito ? "" : q(monto)}</td>
        <td class="num strong">${q(corriente)}</td>
      </tr>`;
    })
    .join("");

  const sinMovimientos = `
    <tr><td colspan="5" class="vacio">Sin movimientos en el período</td></tr>`;

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8" />
<style>
  @page { size: A4; margin: 14mm 12mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: #0f172a;
    font-size: 11px;
  }
  .head {
    background: #002262;
    color: #fff;
    padding: 16px 18px;
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
  }
  .head h1 { margin: 0; font-size: 18px; letter-spacing: -0.02em; }
  .head .sub { margin-top: 4px; font-size: 11px; color: #bfdbfe; }
  .head .right { text-align: right; font-size: 10px; color: #bfdbfe; }
  .head .right strong { color: #fff; display: block; font-size: 12px; }

  .resumen { display: flex; gap: 10px; margin: 14px 0 18px; }
  .card {
    flex: 1;
    border: 0.5px solid #cbd5e1;
    border-radius: 6px;
    padding: 10px 12px;
  }
  .card .k {
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #64748b;
  }
  .card .v {
    margin-top: 4px;
    font-size: 15px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  .card.final { border: 2px solid #004FD0; }
  .card.final .v { color: #004FD0; }

  table { width: 100%; border-collapse: collapse; }
  th {
    text-align: left;
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #64748b;
    border-bottom: 0.5px solid #cbd5e1;
    padding: 6px 8px;
  }
  td { padding: 6px 8px; border-bottom: 0.5px solid #e2e8f0; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .strong { font-weight: 700; }
  .vacio { text-align: center; color: #94a3b8; padding: 18px; }
  tfoot td { border-top: 0.5px solid #cbd5e1; font-weight: 700; }
  .pie {
    margin-top: 16px;
    font-size: 9px;
    color: #94a3b8;
    display: flex;
    justify-content: space-between;
  }
</style>
</head>
<body>
  <div class="head">
    <div>
      <h1>Estado de cuenta</h1>
      <div class="sub"><strong>${esc(d.cliente.nombre)}</strong>${
        d.cliente.nit ? ` · NIT ${esc(d.cliente.nit)}` : ""
      }</div>
    </div>
    <div class="right">
      PERÍODO
      <strong>${esc(d.periodoLabel)}</strong>
      <div style="margin-top:6px">Generado: ${esc(d.fechaGeneracion)}</div>
    </div>
  </div>

  <div class="resumen">
    <div class="card"><div class="k">Saldo inicial</div><div class="v">Q ${q(d.saldo_inicial)}</div></div>
    <div class="card"><div class="k">Abonos</div><div class="v">Q ${q(d.total_abonos)}</div></div>
    <div class="card"><div class="k">Consumos</div><div class="v">Q ${q(d.total_debitos)}</div></div>
    <div class="card final"><div class="k">Saldo final</div><div class="v">Q ${q(d.saldo_final)}</div></div>
  </div>

  <table>
    <thead>
      <tr>
        <th style="width:70px">Fecha</th>
        <th>Descripción</th>
        <th class="num" style="width:80px">Abono</th>
        <th class="num" style="width:80px">Consumo</th>
        <th class="num" style="width:90px">Saldo</th>
      </tr>
    </thead>
    <tbody>${filas || sinMovimientos}</tbody>
    <tfoot>
      <tr>
        <td colspan="2">Totales del período</td>
        <td class="num">Q ${q(d.total_abonos)}</td>
        <td class="num">Q ${q(d.total_debitos)}</td>
        <td class="num">Q ${q(d.saldo_final)}</td>
      </tr>
    </tfoot>
  </table>

  <div class="pie">
    <span>Gasolinera La Estación · Morales, Izabal</span>
    <span>Un saldo negativo indica consumo por encima de lo abonado.</span>
  </div>
</body>
</html>`;
}
