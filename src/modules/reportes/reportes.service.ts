import { Injectable } from "@nestjs/common";
import {
  and,
  count,
  countDistinct,
  eq,
  gte,
  sql,
  sum,
  type SQL,
} from "drizzle-orm";
import { DbService } from "../../db/db.service";
import {
  despachos,
  despachoDetalles,
  vehiculos,
  pilotos,
} from "../../db/schema";
import { fechaGtSql } from "../../common/hora-guatemala";

export interface ReporteFilters {
  cliente_id?: string;
  gasolinera_id?: string;
  fecha_desde?: string;
  fecha_hasta?: string;
}

@Injectable()
export class ReportesService {
  constructor(private db: DbService) {}

  private buildConditions(filters: ReporteFilters): SQL[] {
    const conds: SQL[] = [];
    if (filters.cliente_id)
      conds.push(eq(despachos.cliente_id, filters.cliente_id));
    if (filters.gasolinera_id)
      conds.push(eq(despachos.gasolinera_id, filters.gasolinera_id));
    if (filters.fecha_desde)
      conds.push(
        sql`${fechaGtSql(despachos.despachado_at)} >= ${filters.fecha_desde}::date`,
      );
    if (filters.fecha_hasta)
      conds.push(
        sql`${fechaGtSql(despachos.despachado_at)} <= ${filters.fecha_hasta}::date`,
      );
    return conds;
  }

  async resumen(filters: ReporteFilters) {
    const conds = this.buildConditions(filters);
    const where = conds.length ? and(...conds) : undefined;

    const [totales] = await this.db.db
      .select({
        total_galones: sum(despachos.galones),
        total_monto: sum(despachos.monto_total),
        total_despachos: count(despachos.id),
      })
      .from(despachos)
      .where(where);

    // Por renglón y no por el precio_id del header: un vale mixto lleva un
    // combustible por renglón, y uno sólo de contenedores no tiene precio_id.
    const porTipo = await this.db.db
      .select({
        tipo_combustible: despachoDetalles.tipo_combustible,
        total_galones: sum(despachoDetalles.galones),
        total_monto: sum(despachoDetalles.monto),
        // Vales que llevan ese combustible: un vale mixto cuenta en cada uno.
        total_despachos: countDistinct(despachos.id),
      })
      .from(despachoDetalles)
      .innerJoin(despachos, eq(despachoDetalles.despacho_id, despachos.id))
      .where(where)
      .groupBy(despachoDetalles.tipo_combustible);

    const porGasolinera = await this.db.db
      .select({
        gasolinera_id: despachos.gasolinera_id,
        total_galones: sum(despachos.galones),
        total_monto: sum(despachos.monto_total),
        total_despachos: count(despachos.id),
      })
      .from(despachos)
      .where(where)
      .groupBy(despachos.gasolinera_id);

    // Primer día de Guatemala con despachos para el mismo cliente/estación,
    // sin el rango de fechas. El portal oculta el "vs per. ant." si el
    // periodo anterior empieza antes: con historia incompleta el % se infla.
    // ::text porque node-postgres convierte un `date` a Date en hora local.
    const sinRango = this.buildConditions({
      cliente_id: filters.cliente_id,
      gasolinera_id: filters.gasolinera_id,
    });
    const [{ primer_despacho }] = await this.db.db
      .select({
        primer_despacho: sql<
          string | null
        >`min(${fechaGtSql(despachos.despachado_at)})::text`,
      })
      .from(despachos)
      .where(sinRango.length ? and(...sinRango) : undefined);

    return {
      totales,
      por_tipo_combustible: porTipo,
      por_gasolinera: porGasolinera,
      primer_despacho,
    };
  }

  /**
   * Al vehículo y a su piloto les toca sólo el renglón `vehiculo`, igual que
   * en los límites: las canecas y toneles del mismo vale cuentan en los
   * totales del resumen, no en el ranking.
   */
  private soloRenglonVehiculo(filters: ReporteFilters): SQL | undefined {
    return and(
      ...this.buildConditions(filters),
      eq(despachoDetalles.renglon, "vehiculo"),
    );
  }

  async consumoPorVehiculo(filters: ReporteFilters) {
    return this.db.db
      .select({
        vehiculo_id: despachos.vehiculo_id,
        placa: vehiculos.placa,
        marca: vehiculos.marca,
        modelo: vehiculos.modelo,
        total_galones: sum(despachoDetalles.galones),
        total_monto: sum(despachoDetalles.monto),
        total_despachos: countDistinct(despachos.id),
      })
      .from(despachoDetalles)
      .innerJoin(despachos, eq(despachoDetalles.despacho_id, despachos.id))
      .innerJoin(vehiculos, eq(despachos.vehiculo_id, vehiculos.id))
      .where(this.soloRenglonVehiculo(filters))
      .groupBy(
        despachos.vehiculo_id,
        vehiculos.placa,
        vehiculos.marca,
        vehiculos.modelo,
      )
      .orderBy(sql`sum(${despachoDetalles.galones}) DESC`);
  }

  async consumoPorPiloto(filters: ReporteFilters) {
    return this.db.db
      .select({
        piloto_id: despachos.piloto_id,
        nombre_completo: pilotos.nombre_completo,
        codigo: pilotos.codigo,
        total_galones: sum(despachoDetalles.galones),
        total_monto: sum(despachoDetalles.monto),
        total_despachos: countDistinct(despachos.id),
      })
      .from(despachoDetalles)
      .innerJoin(despachos, eq(despachoDetalles.despacho_id, despachos.id))
      .innerJoin(pilotos, eq(despachos.piloto_id, pilotos.id))
      .where(this.soloRenglonVehiculo(filters))
      .groupBy(despachos.piloto_id, pilotos.nombre_completo, pilotos.codigo)
      .orderBy(sql`sum(${despachoDetalles.galones}) DESC`);
  }

  async tendenciaMensual(filters: ReporteFilters) {
    const conds = this.buildConditions(filters);
    // Sigue el rango pedido (las pestañas de 1/3/6/12 meses del portal); sin
    // rango, los últimos 12 meses.
    if (!filters.fecha_desde && !filters.fecha_hasta)
      conds.push(
        gte(despachos.despachado_at, sql`NOW() - INTERVAL '12 months'`),
      );
    const where = and(...conds);
    // Agrupa por mes de Guatemala (UTC-6), no por mes UTC.
    const fechaGt = fechaGtSql(despachos.despachado_at);

    return this.db.db
      .select({
        anio: sql<number>`EXTRACT(YEAR FROM ${fechaGt})::int`,
        mes: sql<number>`EXTRACT(MONTH FROM ${fechaGt})::int`,
        total_galones: sum(despachos.galones),
        total_monto: sum(despachos.monto_total),
        total_despachos: count(despachos.id),
      })
      .from(despachos)
      .where(where)
      .groupBy(
        sql`EXTRACT(YEAR FROM ${fechaGt})`,
        sql`EXTRACT(MONTH FROM ${fechaGt})`,
      )
      .orderBy(
        sql`EXTRACT(YEAR FROM ${fechaGt})`,
        sql`EXTRACT(MONTH FROM ${fechaGt})`,
      );
  }

  async rendimientoVehiculo(
    vehiculoId: string,
    user?: { rol: string; cliente_id?: string | null },
  ) {
    const condiciones = [eq(despachos.vehiculo_id, vehiculoId)];
    if (user?.rol === "cliente") {
      // Vehículo ajeno: lista vacía, igual que uno sin despachos.
      if (!user.cliente_id) return [];
      condiciones.push(eq(despachos.cliente_id, user.cliente_id));
    }
    return this.db.db
      .select({
        despacho_id: despachos.id,
        despachado_at: despachos.despachado_at,
        galones: despachos.galones,
        kilometraje: despachos.kilometraje,
        km_por_galon: sql<string>`
          CASE
            WHEN ${despachos.galones}::numeric > 0 AND ${despachos.kilometraje}::numeric > 0
            THEN ROUND(${despachos.kilometraje}::numeric / ${despachos.galones}::numeric, 2)::text
            ELSE NULL
          END
        `,
      })
      .from(despachos)
      .where(and(...condiciones))
      .orderBy(despachos.despachado_at);
  }
}
