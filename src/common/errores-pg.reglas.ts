/**
 * SQLSTATE de un error de Postgres. node-postgres lo deja en `code`, pero
 * drizzle (0.45+) envuelve el error en DrizzleQueryError y el original queda
 * en `cause`: mirar sólo `code` hacía que un vale duplicado saliera como 500
 * en vez de 409.
 */
export function codigoPg(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const e = error as { code?: unknown; cause?: unknown };
  if (typeof e.code === "string") return e.code;
  return codigoPg(e.cause);
}

export const VIOLACION_UNICA = "23505";

export function esViolacionUnica(error: unknown): boolean {
  return codigoPg(error) === VIOLACION_UNICA;
}
