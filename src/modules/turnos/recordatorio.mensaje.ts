import type { MensajePush } from "../../push/push.service";
import { escaparHtml } from "../../common/escapar-html";
import { NOMBRE_TURNO, type Turno } from "./turnos.constants";

const NOMBRE_COMBUSTIBLE: Record<string, string> = {
  super: "Súper",
  regular: "Regular",
  diesel: "Diésel",
  gas_lp: "Gas LP",
};
const ORDEN = ["super", "regular", "diesel", "gas_lp"];

const q = (v: string) => `Q ${Number(v).toFixed(3)}`;

export function armarRecordatorio(e: {
  gasolinera: string;
  turno: Turno;
  horaInicio: string;
  precios: { tipo_combustible: string; precio_galon: string }[];
  frontendUrl: string;
  rol: "admin" | "jefe_pista";
}): { asunto: string; texto: string; html: string; push: MensajePush } {
  const ruta = e.rol === "jefe_pista" ? "/jefe" : "/admin/precios";
  const turno = NOMBRE_TURNO[e.turno];
  const precios = [...e.precios].sort(
    (a, b) => ORDEN.indexOf(a.tipo_combustible) - ORDEN.indexOf(b.tipo_combustible),
  );
  const nombre = (t: string) => NOMBRE_COMBUSTIBLE[t] ?? t;

  const asunto = `Turno ${turno} en ${e.gasolinera} empieza a las ${e.horaInicio}: revisa los precios`;
  const lineas = precios.length
    ? precios.map((p) => `${nombre(p.tipo_combustible)}: ${q(p.precio_galon)}`)
    : [`Todavía no hay precios cargados para hoy en ${e.gasolinera}.`];
  const enlace = `${e.frontendUrl}${ruta}`;

  const texto = [
    `En 30 minutos empieza el turno ${turno} en ${e.gasolinera} (${e.horaInicio}).`,
    "",
    precios.length ? "Precios vigentes:" : "",
    ...lineas,
    "",
    `Revisar precios: ${enlace}`,
  ].join("\n");

  const html = `<p>En 30 minutos empieza el turno <strong>${turno}</strong> en <strong>${escaparHtml(e.gasolinera)}</strong> (${e.horaInicio}).</p>
${precios.length ? `<p>Precios vigentes:</p><ul>${lineas.map((l) => `<li>${escaparHtml(l)}</li>`).join("")}</ul>` : `<p>${escaparHtml(lineas[0])}</p>`}
<p><a href="${escaparHtml(enlace)}">Revisar precios</a></p>`;

  const push: MensajePush = {
    title: `Turno ${turno} · ${e.horaInicio}`,
    body: `${e.gasolinera}: ${
      precios.length
        ? precios.map((p) => `${nombre(p.tipo_combustible)} ${q(p.precio_galon)}`).join(" · ")
        : "Sin precios cargados hoy"
    }`,
    url: ruta,
  };

  return { asunto, texto, html, push };
}
