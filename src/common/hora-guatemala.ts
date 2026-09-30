import { sql, type AnyColumn, type SQL } from "drizzle-orm";

/**
 * Hora de Guatemala: UTC−6 fijo. Guatemala no tiene horario de verano, así
 * que un desfase constante es exacto; no usamos AT TIME ZONE para que la
 * aritmética sea idéntica en JS y en SQL.
 *
 * Todo "hoy" del negocio (precio del día, filtros por fecha, recordatorios)
 * sale de aquí. `new Date().toISOString()` da la fecha UTC, que de 18:00 a
 * 23:59 en Guatemala ya es mañana.
 */
const DESFASE_MS = 6 * 3600 * 1000;

export function ahoraGuatemala(ahoraUtc: Date = new Date()): {
  fecha: string;
  minutos: number;
  diaSemana: number;
} {
  const gt = new Date(ahoraUtc.getTime() - DESFASE_MS);
  return {
    fecha: gt.toISOString().slice(0, 10),
    minutos: gt.getUTCHours() * 60 + gt.getUTCMinutes(),
    diaSemana: gt.getUTCDay(),
  };
}

export function fechaGuatemala(ahoraUtc: Date = new Date()): string {
  return ahoraGuatemala(ahoraUtc).fecha;
}

export function sumarDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

export function aMinutos(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/** Fecha de Guatemala de una columna timestamp guardada en UTC. */
export function fechaGtSql(col: AnyColumn): SQL {
  return sql`(${col} - INTERVAL '6 hours')::date`;
}
