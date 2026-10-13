// src/modules/despachos/vales-pdf.template.ts
// Plantilla pura del PDF de vales: hoja carta, 4 vales por hoja. Autocontenida
// (sin fuentes remotas ni scripts): el renderer no tiene red. Es una copia
// digital, nunca un original: el pie lo dice y el texto "ORIGINAL" no aparece.
import { escaparHtml } from "../../common/escapar-html";
import { deACuatro } from "./vales-pdf.reglas";

export interface ValePdf {
  serie_vale: string;
  numero_vale: string;
  correlativo_cliente: number;
  despachado_at: Date | string;
  turno: string;
  bomba_numero: number | null;
  gasolinera: { nombre: string; ciudad: string | null };
  cliente: { nombre: string; nit: string | null };
  vehiculo: {
    placa: string;
    marca: string | null;
    modelo: string | null;
  } | null;
  piloto: { nombre_completo: string } | null;
  kilometraje: string | null;
  renglones: {
    renglon: string;
    tipo_combustible: string;
    galones: string;
    precio_galon: string | null;
    monto: string;
  }[];
  monto_total: string;
  galones: string;
  operario: string | null;
  despachador: string | null;
  firma: string | null; // data-URL PNG
}

const TIPO_COMB_LABEL: Record<string, string> = {
  diesel: "DIESEL",
  super: "GASOLINA SUPER",
  regular: "GASOLINA REGULAR",
  gas_lp: "GAS LP",
};

const RENGLON_TAG: Record<string, string> = {
  vehiculo: "",
  caneca: "CANECAS · ",
  tonel: "TONELES · ",
};

const PREFIJO_FIRMA = "data:image/png;base64,";
const FIRMA_VALIDA = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/;

function esc(v: string | number | null | undefined): string {
  return v == null || v === "" ? "—" : escaparHtml(String(v));
}

function num(v: string | null, decimales: number): string {
  const n = v == null ? NaN : parseFloat(v);
  if (isNaN(n)) return "—";
  return n.toLocaleString("es-GT", {
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
  });
}

function fechaHora(d: Date | string): string {
  const dt = typeof d === "string" ? new Date(d) : d;
  if (isNaN(dt.getTime())) return "—";
  return dt.toLocaleString("es-GT", {
    timeZone: "America/Guatemala",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function renglonHtml(r: ValePdf["renglones"][number]): string {
  const etiqueta =
    TIPO_COMB_LABEL[r.tipo_combustible] ??
    String(r.tipo_combustible ?? "").toUpperCase();
  const precio =
    r.precio_galon != null ? `Q ${num(r.precio_galon, 3)}/gal` : "—";
  return `<tr>
      <td>${esc((RENGLON_TAG[r.renglon] ?? "") + etiqueta)}</td>
      <td class="n">${num(r.galones, 3)}</td>
      <td class="n mono">${precio}</td>
      <td class="n">Q ${num(r.monto, 2)}</td>
    </tr>`;
}

function firmaHtml(firma: string | null): string {
  if (firma && firma.startsWith(PREFIJO_FIRMA) && FIRMA_VALIDA.test(firma)) {
    return `<img class="firma" src="${firma}" alt="Firma" />`;
  }
  return `<span class="sin-firma">Firma no disponible</span>`;
}

function valeHtml(v: ValePdf): string {
  const veh = v.vehiculo
    ? `<span class="mono">${esc(v.vehiculo.placa)}</span> ${esc(
        [v.vehiculo.marca, v.vehiculo.modelo].filter(Boolean).join(" ") || null,
      )}`
    : "Sin vehículo";
  const turno = v.turno === "manana" ? "MAÑANA" : "TARDE";
  const lugar = [v.gasolinera.nombre, v.gasolinera.ciudad]
    .filter(Boolean)
    .join(" · ");
  return `<article class="vale">
    <header>
      <div class="lugar">${esc(lugar)}</div>
      <div class="ident"><span class="mono vnum">${esc(v.serie_vale)}-${esc(v.numero_vale)}</span>
        <span class="ncli">N° cliente ${esc(v.correlativo_cliente)}</span></div>
    </header>
    <div class="meta">${esc(fechaHora(v.despachado_at))} · Bomba ${esc(v.bomba_numero)} · Turno ${turno}</div>
    <div class="datos">
      <div><b>Cliente:</b> ${esc(v.cliente.nombre)}${v.cliente.nit ? ` · NIT ${esc(v.cliente.nit)}` : ""}</div>
      <div><b>Vehículo:</b> ${veh}${v.kilometraje != null ? ` · Km ${num(v.kilometraje, 0)}` : ""}</div>
      <div><b>Piloto:</b> ${esc(v.piloto?.nombre_completo)}</div>
    </div>
    <table>
      <thead><tr><th>Combustible</th><th class="n">Galones</th><th class="n">Precio</th><th class="n">Subtotal</th></tr></thead>
      <tbody>${v.renglones.map(renglonHtml).join("")}</tbody>
      <tfoot><tr><td>Total</td><td class="n">${num(v.galones, 3)}</td><td></td><td class="n">Q ${num(v.monto_total, 2)}</td></tr></tfoot>
    </table>
    <footer>
      <div class="pers">
        <div><b>Despachado por:</b> ${esc(v.despachador)}</div>
        ${v.operario ? `<div><b>Operario:</b> ${esc(v.operario)}</div>` : ""}
      </div>
      <div class="firma-caja">${firmaHtml(v.firma)}</div>
    </footer>
  </article>`;
}

const CSS = `
  @page { size: letter; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: "DM Sans", "Helvetica Neue", Helvetica, Arial, sans-serif;
    font-size: 9pt; color: #000; background: #fff;
    font-variant-numeric: tabular-nums;
  }
  .mono { font-family: "JetBrains Mono", "SF Mono", Menlo, Consolas, "Liberation Mono", monospace; }
  .hoja {
    width: 8.5in; height: 11in; padding: 0.3in;
    display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr;
    gap: 0.15in; break-after: page; page-break-after: always; overflow: hidden;
  }
  .hoja:last-of-type { break-after: auto; page-break-after: auto; }
  .vale {
    break-inside: avoid; page-break-inside: avoid; overflow: hidden;
    border: 0.5px solid #000; padding: 0.1in 0.12in; min-height: 0;
    display: flex; flex-direction: column; gap: 3px;
  }
  header { display: flex; justify-content: space-between; align-items: baseline; border-bottom: 0.5px solid #000; padding-bottom: 3px; }
  .lugar { font-weight: 700; font-size: 9pt; }
  .vnum { font-size: 11pt; font-weight: 700; }
  .ncli { margin-left: 6px; font-size: 8.5pt; }
  .ident { text-align: right; white-space: nowrap; }
  .meta { font-size: 8pt; }
  .datos { font-size: 8.5pt; line-height: 1.3; }
  table { width: 100%; border-collapse: collapse; font-size: 8.5pt; }
  th, td { padding: 1.5px 3px; text-align: left; border-bottom: 0.5px solid #000; }
  th.n, td.n { text-align: right; }
  tfoot td { font-weight: 700; border-bottom: none; }
  footer { display: flex; justify-content: space-between; align-items: flex-end; gap: 6px; margin-top: auto; font-size: 8pt; }
  .firma-caja { width: 1.6in; height: 0.55in; border-bottom: 0.5px solid #000; display: flex; align-items: flex-end; justify-content: center; }
  .firma { max-width: 100%; max-height: 0.55in; object-fit: contain; }
  .sin-firma { font-size: 7.5pt; font-style: italic; }
  .pie { position: fixed; left: 0; right: 0; bottom: 0.1in; text-align: center; font-size: 7.5pt; }
`;

export function buildValesHtml(d: {
  vales: ValePdf[];
  generadoEn: string;
}): string {
  const hojas = deACuatro(d.vales)
    .map(
      (grupo) =>
        `<section class="hoja">${grupo.map(valeHtml).join("")}</section>`,
    )
    .join("");
  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8" /><title>Vales</title>
<style>${CSS}</style></head>
<body>${hojas}
<div class="pie">Copia digital — generada el ${esc(d.generadoEn)}</div>
</body></html>`;
}
