import { ahoraGuatemala, aMinutos, sumarDias } from "../../common/hora-guatemala";
import type { Turno } from "./turnos.constants";

export const MINUTOS_ANTES = 30;
const DIA = 1440;

interface Horario {
  hora_inicio: string;
  hora_fin: string;
}

/**
 * Intervalos [desde, hasta) en minutos del día. Un turno cuyo fin es menor
 * que su inicio cruza la medianoche y se parte en dos.
 */
export function segmentos(inicio: string, fin: string): [number, number][] {
  const a = aMinutos(inicio);
  const b = aMinutos(fin);
  return b > a ? [[a, b]] : [[a, DIA], [0, b]];
}

export function seSolapan(x: Horario, y: Horario): boolean {
  const sx = segmentos(x.hora_inicio, x.hora_fin);
  const sy = segmentos(y.hora_inicio, y.hora_fin);
  return sx.some(([a1, a2]) => sy.some(([b1, b2]) => a1 < b2 && b1 < a2));
}

export function turnoEnMinuto<T extends Horario & { turno: Turno }>(
  turnos: T[],
  minuto: number,
): T | null {
  return (
    turnos.find((t) =>
      segmentos(t.hora_inicio, t.hora_fin).some(
        ([a, b]) => minuto >= a && minuto < b,
      ),
    ) ?? null
  );
}

/**
 * ¿Toca avisar ahora del próximo inicio de este turno?
 *
 * Ventana y no minuto exacto: si el backend estuvo caído a las 13:30 y levanta
 * a las 13:41, el aviso de las 14:00 igual sale. La idempotencia la pone el
 * índice único de recordatorios_turno, no esta función.
 *
 * Devuelve la fecha de Guatemala del día en que ARRANCA el turno: un turno de
 * las 00:15 avisado a las 23:45 pertenece al día siguiente.
 */
export function debeRecordar(
  ahoraUtc: Date,
  horaInicio: string,
): { fecha: string } | null {
  const { fecha, minutos } = ahoraGuatemala(ahoraUtc);
  let faltan = aMinutos(horaInicio) - minutos;
  let fechaInicio = fecha;
  if (faltan <= 0) {
    faltan += DIA;
    fechaInicio = sumarDias(fecha, 1);
  }
  return faltan <= MINUTOS_ANTES ? { fecha: fechaInicio } : null;
}
