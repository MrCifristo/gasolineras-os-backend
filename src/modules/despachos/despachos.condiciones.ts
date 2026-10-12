import { eq, sql, type SQL } from "drizzle-orm";
import type { UsuarioSesion } from "../../auth/usuario-actual";
import { fechaGtSql } from "../../common/hora-guatemala";
import { despachos } from "../../db/schema";

export interface DespachoFilters {
  gasolinera_id?: string;
  cliente_id?: string;
  vehiculo_id?: string;
  piloto_id?: string;
  fecha_desde?: string;
  fecha_hasta?: string;
  turno?: string;
  tipo_combustible?: string;
  page?: number;
  limit?: number;
}

/**
 * Condiciones WHERE del listado de despachos: alcance por rol + los filtros.
 * Lo comparten el listado, el export a Excel y el PDF de vales.
 *
 * Devuelve `null` cuando el usuario falla cerrado (un supervisor sin
 * gasolinera, un cliente sin empresa): el llamador responde vacío.
 */
export function condicionesDespachos(
  filtros: Omit<DespachoFilters, "page" | "limit">,
  usuario: UsuarioSesion,
): SQL[] | null {
  const conditions: SQL[] = [];

  if (usuario.rol === "supervisor") {
    if (!usuario.gasolinera_id) return null;
    conditions.push(eq(despachos.gasolinera_id, usuario.gasolinera_id));
  }
  if (usuario.rol === "cliente") {
    if (!usuario.cliente_id) return null;
    conditions.push(eq(despachos.cliente_id, usuario.cliente_id));
  }

  if (filtros.gasolinera_id)
    conditions.push(eq(despachos.gasolinera_id, filtros.gasolinera_id));
  if (filtros.cliente_id)
    conditions.push(eq(despachos.cliente_id, filtros.cliente_id));
  if (filtros.vehiculo_id)
    conditions.push(eq(despachos.vehiculo_id, filtros.vehiculo_id));
  if (filtros.piloto_id)
    conditions.push(eq(despachos.piloto_id, filtros.piloto_id));
  if (filtros.turno) conditions.push(eq(despachos.turno, filtros.turno));
  if (filtros.tipo_combustible) {
    // Se busca en los renglones, no en el precio del header: en un vale mixto
    // el header sólo refleja el renglón principal, así que filtrar por él
    // perdería los vales donde ese combustible fue a una caneca.
    conditions.push(
      sql`EXISTS (
          SELECT 1 FROM despacho_detalles dd
          WHERE dd.despacho_id = ${despachos.id}
            AND dd.tipo_combustible = ${filtros.tipo_combustible}
        )`,
    );
  }
  // Comparar por DATE (día de Guatemala) para evitar problemas de zona horaria
  if (filtros.fecha_desde)
    conditions.push(
      sql`${fechaGtSql(despachos.despachado_at)} >= ${filtros.fecha_desde}::date`,
    );
  if (filtros.fecha_hasta)
    conditions.push(
      sql`${fechaGtSql(despachos.despachado_at)} <= ${filtros.fecha_hasta}::date`,
    );

  return conditions;
}
