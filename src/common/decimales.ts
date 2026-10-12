/**
 * Los campos `numeric` de Postgres se escriben como texto con drizzle, pero
 * los DTO los traen como number. Convierte sólo esos campos y deja el tipo
 * exacto del resultado, así el insert/update se valida contra la tabla.
 */
export type DecimalesComoTexto<T, K extends PropertyKey> = {
  [P in keyof T]: P extends K ? Exclude<T[P], number> | string : T[P];
};

export function decimalesATexto<T extends object, K extends PropertyKey>(
  dto: T,
  campos: readonly K[],
): DecimalesComoTexto<T, K> {
  const out = { ...dto } as Record<PropertyKey, unknown>;
  for (const campo of campos) {
    if (out[campo] != null) out[campo] = String(out[campo]);
  }
  return out as DecimalesComoTexto<T, K>;
}
