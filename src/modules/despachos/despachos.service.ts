import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, eq, gte, lte, sql } from "drizzle-orm";
import { DbService } from "../../db/db.service";
import {
  despachos,
  movimientosSaldo,
  preciosCombustible,
  saldosCliente,
  vehiculos,
  pilotos,
  gasolineras,
  clientes,
} from "../../db/schema";
import { CreateDespachoDto } from "./dto/create-despacho.dto";
import { UpdateDespachoDto } from "./dto/update-despacho.dto";

const GT_DAYS = [
  "domingo",
  "lunes",
  "martes",
  "miercoles",
  "jueves",
  "viernes",
  "sabado",
];

function getGuatemalaTime(): { dayName: string; totalMinutes: number } {
  const gtMs = Date.now() - 6 * 3600 * 1000;
  const gt = new Date(gtMs);
  const totalMinutes = gt.getUTCHours() * 60 + gt.getUTCMinutes();
  return { dayName: GT_DAYS[gt.getUTCDay()], totalMinutes };
}

function hhmm(timeStr: string): number {
  const [h, m] = timeStr.split(":").map(Number);
  return h * 60 + m;
}

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

@Injectable()
export class DespachosService {
  constructor(private db: DbService) {}

  async findAll(filters: DespachoFilters, user: any) {
    const { page = 1, limit = 20, ...rest } = filters;
    const offset = (page - 1) * limit;
    const conditions: any[] = [];

    if (user.rol === "operario")
      conditions.push(eq(despachos.gasolinera_id, user.gasolinera_id));
    if (user.rol === "cliente")
      conditions.push(eq(despachos.cliente_id, user.cliente_id));

    if (rest.gasolinera_id)
      conditions.push(eq(despachos.gasolinera_id, rest.gasolinera_id));
    if (rest.cliente_id)
      conditions.push(eq(despachos.cliente_id, rest.cliente_id));
    if (rest.vehiculo_id)
      conditions.push(eq(despachos.vehiculo_id, rest.vehiculo_id));
    if (rest.piloto_id)
      conditions.push(eq(despachos.piloto_id, rest.piloto_id));
    if (rest.turno) conditions.push(eq(despachos.turno, rest.turno));
    if (rest.tipo_combustible) {
      // Filtra via JOIN con preciosCombustible — el tipo está en la tabla de precios
      conditions.push(
        sql`${despachos.precio_id} IN (
          SELECT id FROM precios_combustible WHERE tipo_combustible = ${rest.tipo_combustible}
        )`,
      );
    }
    // Comparar por DATE para evitar problemas de zona horaria con TIMESTAMP
    if (rest.fecha_desde)
      conditions.push(
        sql`${despachos.despachado_at}::date >= ${rest.fecha_desde}::date`,
      );
    if (rest.fecha_hasta)
      conditions.push(
        sql`${despachos.despachado_at}::date <= ${rest.fecha_hasta}::date`,
      );

    return this.db.db
      .select()
      .from(despachos)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(sql`${despachos.despachado_at} DESC`)
      .limit(limit)
      .offset(offset);
  }

  async findOne(id: string) {
    const result = await this.db.db
      .select({
        despacho: despachos,
        vehiculo: vehiculos,
        piloto: pilotos,
        gasolinera: gasolineras,
        precio: preciosCombustible,
        cliente: clientes,
      })
      .from(despachos)
      .innerJoin(vehiculos, eq(despachos.vehiculo_id, vehiculos.id))
      .innerJoin(pilotos, eq(despachos.piloto_id, pilotos.id))
      .innerJoin(gasolineras, eq(despachos.gasolinera_id, gasolineras.id))
      .innerJoin(
        preciosCombustible,
        eq(despachos.precio_id, preciosCombustible.id),
      )
      .innerJoin(clientes, eq(despachos.cliente_id, clientes.id))
      .where(eq(despachos.id, id))
      .limit(1);

    if (!result.length) throw new NotFoundException("Despacho no encontrado");
    return result[0];
  }

  async create(dto: CreateDespachoDto, user: any) {
    if (user.rol !== "operario" && user.rol !== "admin") {
      throw new ForbiddenException("Solo operarios pueden crear despachos");
    }

    // ── Restricciones del vehículo ──────────────────────────────────
    const [v] = await this.db.db
      .select()
      .from(vehiculos)
      .where(eq(vehiculos.id, dto.vehiculo_id))
      .limit(1);

    if (!v) throw new NotFoundException("Vehículo no encontrado");

    if (v.bloqueado) {
      throw new ForbiddenException(
        "Vehículo bloqueado — consulte con su administrador",
      );
    }

    if (
      v.productos_permitidos &&
      v.productos_permitidos.length > 0 &&
      !v.productos_permitidos.includes(dto.tipo_combustible)
    ) {
      throw new ForbiddenException(
        `Este vehículo no puede cargar ${dto.tipo_combustible}`,
      );
    }

    const { dayName, totalMinutes } = getGuatemalaTime();

    if (v.dias_permitidos && v.dias_permitidos.length > 0) {
      if (!v.dias_permitidos.includes(dayName)) {
        throw new ForbiddenException(
          `Despacho no permitido hoy (${dayName}) para este vehículo`,
        );
      }
    }

    if (v.hora_inicio && v.hora_fin) {
      const inicio = hhmm(v.hora_inicio);
      const fin = hhmm(v.hora_fin);
      if (totalMinutes < inicio || totalMinutes > fin) {
        throw new ForbiddenException(
          `Despacho fuera del horario autorizado (${v.hora_inicio}–${v.hora_fin})`,
        );
      }
    }

    // ── Cálculo de precio (antes de la matriz de límites) ────────────
    const today = new Date().toISOString().split("T")[0];
    const precio = await this.db.db
      .select()
      .from(preciosCombustible)
      .where(
        and(
          eq(preciosCombustible.gasolinera_id, user.gasolinera_id),
          eq(preciosCombustible.fecha, today),
          eq(preciosCombustible.tipo_combustible, dto.tipo_combustible),
        ),
      )
      .limit(1);

    if (!precio.length) {
      throw new BadRequestException(
        `No hay precio registrado para ${dto.tipo_combustible} hoy en esta gasolinera`,
      );
    }

    const precioRow = precio[0];
    const galonesEstimado = parseFloat(dto.galones);
    const montoEstimado = galonesEstimado * parseFloat(precioRow.precio_galon);
    const montoTotal = montoEstimado.toFixed(3);

    // ── Límites por transacción (sin query) ──────────────────────────
    const num = (x: unknown) => (x != null ? parseFloat(String(x)) : null);
    const lmt = num(v.limite_monto_transaccion);
    if (lmt != null && montoEstimado > lmt)
      throw new ForbiddenException(
        `Monto por transacción supera el límite (Q${lmt.toFixed(2)})`,
      );
    const lvt = num(v.limite_volumen_transaccion);
    if (lvt != null && galonesEstimado > lvt)
      throw new ForbiddenException(
        `Volumen por transacción supera el límite (${lvt.toFixed(2)} gal)`,
      );

    // ── Límites acumulados (una query con FILTER) ────────────────────
    const needsAggregate =
      v.limite_monto_dia != null ||
      v.limite_monto_semana != null ||
      v.limite_monto_mes != null ||
      v.limite_volumen_dia != null ||
      v.limite_volumen_semana != null ||
      v.limite_volumen_mes != null ||
      v.limite_trans_dia != null ||
      v.limite_trans_semana != null ||
      v.limite_trans_mes != null;
    if (needsAggregate) {
      const [agg] = await this.db.db
        .select({
          monto_dia: sql<number>`COALESCE(SUM(${despachos.monto_total}::numeric) FILTER (WHERE (${despachos.despachado_at} - INTERVAL '6 hours')::date = (NOW() - INTERVAL '6 hours')::date), 0)`,
          monto_semana: sql<number>`COALESCE(SUM(${despachos.monto_total}::numeric) FILTER (WHERE date_trunc('week', ${despachos.despachado_at} - INTERVAL '6 hours') = date_trunc('week', NOW() - INTERVAL '6 hours')), 0)`,
          monto_mes: sql<number>`COALESCE(SUM(${despachos.monto_total}::numeric) FILTER (WHERE date_trunc('month', ${despachos.despachado_at} - INTERVAL '6 hours') = date_trunc('month', NOW() - INTERVAL '6 hours')), 0)`,
          vol_dia: sql<number>`COALESCE(SUM(${despachos.galones}::numeric) FILTER (WHERE (${despachos.despachado_at} - INTERVAL '6 hours')::date = (NOW() - INTERVAL '6 hours')::date), 0)`,
          vol_semana: sql<number>`COALESCE(SUM(${despachos.galones}::numeric) FILTER (WHERE date_trunc('week', ${despachos.despachado_at} - INTERVAL '6 hours') = date_trunc('week', NOW() - INTERVAL '6 hours')), 0)`,
          vol_mes: sql<number>`COALESCE(SUM(${despachos.galones}::numeric) FILTER (WHERE date_trunc('month', ${despachos.despachado_at} - INTERVAL '6 hours') = date_trunc('month', NOW() - INTERVAL '6 hours')), 0)`,
          trans_dia: sql<number>`COUNT(*) FILTER (WHERE (${despachos.despachado_at} - INTERVAL '6 hours')::date = (NOW() - INTERVAL '6 hours')::date)`,
          trans_semana: sql<number>`COUNT(*) FILTER (WHERE date_trunc('week', ${despachos.despachado_at} - INTERVAL '6 hours') = date_trunc('week', NOW() - INTERVAL '6 hours'))`,
          trans_mes: sql<number>`COUNT(*) FILTER (WHERE date_trunc('month', ${despachos.despachado_at} - INTERVAL '6 hours') = date_trunc('month', NOW() - INTERVAL '6 hours'))`,
        })
        .from(despachos)
        .where(eq(despachos.vehiculo_id, dto.vehiculo_id));

      const checks: Array<[number | null, number, number, string]> = [
        [num(v.limite_monto_dia), parseFloat(String(agg.monto_dia)), montoEstimado, `Límite diario de monto superado`],
        [num(v.limite_monto_semana), parseFloat(String(agg.monto_semana)), montoEstimado, `Límite semanal de monto superado`],
        [num(v.limite_monto_mes), parseFloat(String(agg.monto_mes)), montoEstimado, `Límite mensual de monto superado`],
        [num(v.limite_volumen_dia), parseFloat(String(agg.vol_dia)), galonesEstimado, `Límite diario de volumen superado`],
        [num(v.limite_volumen_semana), parseFloat(String(agg.vol_semana)), galonesEstimado, `Límite semanal de volumen superado`],
        [num(v.limite_volumen_mes), parseFloat(String(agg.vol_mes)), galonesEstimado, `Límite mensual de volumen superado`],
      ];
      for (const [limite, consumido, delta, msg] of checks) {
        if (limite != null && consumido + delta > limite) {
          throw new ForbiddenException(
            `${msg}. Consumido: ${consumido.toFixed(2)} — Límite: ${limite.toFixed(2)}`,
          );
        }
      }
      const transChecks: Array<[number | null, number, string]> = [
        [v.limite_trans_dia, parseInt(String(agg.trans_dia)), "diario"],
        [v.limite_trans_semana, parseInt(String(agg.trans_semana)), "semanal"],
        [v.limite_trans_mes, parseInt(String(agg.trans_mes)), "mensual"],
      ];
      for (const [limite, consumido, periodo] of transChecks) {
        if (limite != null && consumido + 1 > limite) {
          throw new ForbiddenException(
            `Límite ${periodo} de transacciones alcanzado (${limite})`,
          );
        }
      }
    }
    // ────────────────────────────────────────────────────────────────

    return this.db.db.transaction(async (tx) => {
      // Advisory lock por gasolinera+serie para serializar la asignación de numero_vale.
      // pg_advisory_xact_lock toma un bigint — usamos hashtext de la clave compuesta.
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${user.gasolinera_id} || ':' || ${dto.serie_vale}))`,
      );

      // Calcular el siguiente número de vale dentro del bloqueo
      const [{ nextVal }] = await tx
        .select({ nextVal: sql<number>`COUNT(*)::int + 1` })
        .from(despachos)
        .where(
          and(
            eq(despachos.gasolinera_id, user.gasolinera_id),
            eq(despachos.serie_vale, dto.serie_vale),
          ),
        );

      const numeroVale = String(nextVal).padStart(6, "0");

      let despacho: typeof despachos.$inferSelect;
      try {
        [despacho] = await tx
          .insert(despachos)
          .values({
            gasolinera_id: user.gasolinera_id,
            cliente_id: dto.cliente_id,
            vehiculo_id: dto.vehiculo_id,
            piloto_id: dto.piloto_id,
            despachador_id: user.id,
            precio_id: precioRow.id,
            numero_vale: numeroVale,
            serie_vale: dto.serie_vale,
            turno: dto.turno,
            bomba_numero: dto.bomba_numero,
            kilometraje: dto.kilometraje,
            galones: dto.galones,
            monto_total: montoTotal,
            firma_piloto_base64: dto.firma_piloto_base64,
          })
          .returning();
      } catch (e: any) {
        if (e?.code === "23505") {
          throw new ConflictException(
            `El vale ${dto.serie_vale}-${numeroVale} ya existe para esta gasolinera`,
          );
        }
        throw e;
      }

      await tx.insert(movimientosSaldo).values({
        cliente_id: dto.cliente_id,
        gasolinera_id: user.gasolinera_id,
        despacho_id: despacho.id,
        tipo: "debito",
        monto: montoTotal,
        descripcion: `Despacho ${dto.tipo_combustible} ${dto.galones} galones - Vale ${dto.serie_vale}-${numeroVale}`,
      });

      await tx
        .update(saldosCliente)
        .set({
          saldo_actual: sql`saldo_actual - ${montoTotal}::numeric`,
          updated_at: new Date(),
        })
        .where(eq(saldosCliente.cliente_id, dto.cliente_id));

      return despacho;
    });
  }

  async update(id: string, dto: UpdateDespachoDto) {
    await this.findOne(id);
    const [row] = await this.db.db
      .update(despachos)
      .set(dto)
      .where(eq(despachos.id, id))
      .returning();
    return row;
  }

  async getConsumoHoy(vehiculoId: string) {
    const [v] = await this.db.db.select().from(vehiculos).where(eq(vehiculos.id, vehiculoId)).limit(1);
    if (!v) throw new NotFoundException("Vehículo no encontrado");
    const [agg] = await this.db.db
      .select({
        monto_dia: sql<number>`COALESCE(SUM(${despachos.monto_total}::numeric) FILTER (WHERE (${despachos.despachado_at} - INTERVAL '6 hours')::date = (NOW() - INTERVAL '6 hours')::date), 0)`,
        monto_semana: sql<number>`COALESCE(SUM(${despachos.monto_total}::numeric) FILTER (WHERE date_trunc('week', ${despachos.despachado_at} - INTERVAL '6 hours') = date_trunc('week', NOW() - INTERVAL '6 hours')), 0)`,
        monto_mes: sql<number>`COALESCE(SUM(${despachos.monto_total}::numeric) FILTER (WHERE date_trunc('month', ${despachos.despachado_at} - INTERVAL '6 hours') = date_trunc('month', NOW() - INTERVAL '6 hours')), 0)`,
        vol_dia: sql<number>`COALESCE(SUM(${despachos.galones}::numeric) FILTER (WHERE (${despachos.despachado_at} - INTERVAL '6 hours')::date = (NOW() - INTERVAL '6 hours')::date), 0)`,
        vol_semana: sql<number>`COALESCE(SUM(${despachos.galones}::numeric) FILTER (WHERE date_trunc('week', ${despachos.despachado_at} - INTERVAL '6 hours') = date_trunc('week', NOW() - INTERVAL '6 hours')), 0)`,
        vol_mes: sql<number>`COALESCE(SUM(${despachos.galones}::numeric) FILTER (WHERE date_trunc('month', ${despachos.despachado_at} - INTERVAL '6 hours') = date_trunc('month', NOW() - INTERVAL '6 hours')), 0)`,
        trans_dia: sql<number>`COUNT(*) FILTER (WHERE (${despachos.despachado_at} - INTERVAL '6 hours')::date = (NOW() - INTERVAL '6 hours')::date)`,
        trans_semana: sql<number>`COUNT(*) FILTER (WHERE date_trunc('week', ${despachos.despachado_at} - INTERVAL '6 hours') = date_trunc('week', NOW() - INTERVAL '6 hours'))`,
        trans_mes: sql<number>`COUNT(*) FILTER (WHERE date_trunc('month', ${despachos.despachado_at} - INTERVAL '6 hours') = date_trunc('month', NOW() - INTERVAL '6 hours'))`,
      })
      .from(despachos)
      .where(eq(despachos.vehiculo_id, vehiculoId));
    const n = (x: unknown) => (x != null ? parseFloat(String(x)) : null);
    return {
      bloqueado: v.bloqueado ?? false,
      productos_permitidos: v.productos_permitidos ?? null,
      limites: {
        monto: { transaccion: n(v.limite_monto_transaccion), dia: n(v.limite_monto_dia), semana: n(v.limite_monto_semana), mes: n(v.limite_monto_mes) },
        volumen: { transaccion: n(v.limite_volumen_transaccion), dia: n(v.limite_volumen_dia), semana: n(v.limite_volumen_semana), mes: n(v.limite_volumen_mes) },
        transacciones: { dia: v.limite_trans_dia ?? null, semana: v.limite_trans_semana ?? null, mes: v.limite_trans_mes ?? null },
      },
      consumo: {
        monto: { dia: parseFloat(String(agg.monto_dia)), semana: parseFloat(String(agg.monto_semana)), mes: parseFloat(String(agg.monto_mes)) },
        volumen: { dia: parseFloat(String(agg.vol_dia)), semana: parseFloat(String(agg.vol_semana)), mes: parseFloat(String(agg.vol_mes)) },
        transacciones: { dia: parseInt(String(agg.trans_dia)), semana: parseInt(String(agg.trans_semana)), mes: parseInt(String(agg.trans_mes)) },
      },
    };
  }
}
