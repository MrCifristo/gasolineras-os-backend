import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, eq, getTableColumns, gte, lte, sql } from "drizzle-orm";
import {
  ahoraGuatemala,
  aMinutos,
  fechaGuatemala,
  fechaGtSql,
} from "../../common/hora-guatemala";
import { DbService } from "../../db/db.service";
import {
  despachos,
  despachoDetalles,
  movimientosSaldo,
  preciosCombustible,
  saldosCliente,
  vehiculos,
  pilotos,
  gasolineras,
  clientes,
  configuracionSistema,
  usuarios,
  operarios,
} from "../../db/schema";
import { CreateDespachoDto } from "./dto/create-despacho.dto";
import { UpdateDespachoDto } from "./dto/update-despacho.dto";
import {
  exigirClienteConCredito,
  exigirGasolineraOperable,
  exigirRol,
} from "../../common/bloqueos.reglas";
import {
  DIAS_GT,
  exigirOperarioDeLaGasolinera,
  exigirPrecio,
  exigirSistemaActivo,
  exigirVehiculoHabilitado,
  normalizarRenglones,
  resumenRenglones,
  totalesDespacho,
  validarHorarioVehiculo,
  validarParVehiculoPiloto,
  validarProductosPermitidos,
  valorizarRenglon,
} from "./despachos.reglas";
import { StorageService, StorageObject } from "../../storage/storage.service";

type Usuario = typeof usuarios.$inferSelect;

function getGuatemalaTime(): { dayName: string; totalMinutes: number } {
  const { diaSemana, minutos } = ahoraGuatemala();
  return { dayName: DIAS_GT[diaSemana], totalMinutes: minutos };
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
  constructor(
    private db: DbService,
    private storage: StorageService,
  ) {}

  /**
   * Sube la firma del piloto a R2 y devuelve su key, o null si no vino firma.
   *
   * Va ANTES de la transacción de create: si se subiera dentro, el advisory
   * lock que serializa la numeración por gasolinera+serie quedaría tomado
   * durante una llamada de red, congelando la fila de la bomba. Si la subida
   * falla, se lanza y el despacho nunca se abre.
   */
  private async subirFirma(
    firmaBase64: string | undefined,
    gasolineraId: string,
  ): Promise<string | null> {
    if (!firmaBase64) return null;

    // No se confía en el prefijo data:image/png: se decodifica y se verifica la
    // firma mágica del PNG (89 50 4E 47 0D 0A 1A 0A) sobre los bytes reales.
    const base64 = firmaBase64.replace(/^data:image\/png;base64,/, "");
    let bytes: Buffer;
    try {
      bytes = Buffer.from(base64, "base64");
    } catch {
      throw new BadRequestException("Firma inválida");
    }
    const PNG_MAGIC = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    if (bytes.length < 8 || !bytes.subarray(0, 8).equals(PNG_MAGIC)) {
      throw new BadRequestException("La firma debe ser un PNG válido");
    }

    // Key con fecha (hora de Guatemala) para poder barrer huérfanos por antigüedad.
    const gt = new Date(Date.now() - 6 * 3600 * 1000);
    const yyyy = gt.getUTCFullYear();
    const mm = String(gt.getUTCMonth() + 1).padStart(2, "0");
    const key = `firmas/${gasolineraId}/${yyyy}/${mm}/${crypto.randomUUID()}.png`;

    await this.storage.put(key, bytes, "image/png");
    return key;
  }

  async findAll(filters: DespachoFilters, user: any) {
    const { page = 1, limit = 20, ...rest } = filters;
    const offset = (page - 1) * limit;
    const conditions: any[] = [];

    if (user.rol === "cliente" && !user.cliente_id)
      return { data: [], total: 0, page, limit };
    if (user.rol === "supervisor")
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
      // Se busca en los renglones, no en el precio del header: en un vale mixto
      // el header sólo refleja el renglón principal, así que filtrar por él
      // perdería los vales donde ese combustible fue a una caneca.
      conditions.push(
        sql`EXISTS (
          SELECT 1 FROM despacho_detalles dd
          WHERE dd.despacho_id = ${despachos.id}
            AND dd.tipo_combustible = ${rest.tipo_combustible}
        )`,
      );
    }
    // Comparar por DATE para evitar problemas de zona horaria con TIMESTAMP
    if (rest.fecha_desde)
      conditions.push(
        sql`${fechaGtSql(despachos.despachado_at)} >= ${rest.fecha_desde}::date`,
      );
    if (rest.fecha_hasta)
      conditions.push(
        sql`${fechaGtSql(despachos.despachado_at)} <= ${rest.fecha_hasta}::date`,
      );

    const where = conditions.length ? and(...conditions) : undefined;
    const [data, [{ total }]] = await Promise.all([
      this.db.db
        .select({
          ...getTableColumns(despachos),
          operario: { id: operarios.id, nombre: operarios.nombre },
        })
        .from(despachos)
        .leftJoin(operarios, eq(despachos.operario_id, operarios.id))
        .where(where)
        .orderBy(
          sql`${despachos.despachado_at} DESC`,
          sql`${despachos.id} DESC`,
        )
        .limit(limit)
        .offset(offset),
      this.db.db
        .select({ total: sql<number>`count(*)::int` })
        .from(despachos)
        .where(where),
    ]);
    return { data, total, page, limit };
  }

  async findOne(id: string, user: Usuario) {
    // Scoping por rol en el WHERE, no después: un despacho fuera del alcance del
    // usuario responde igual que uno inexistente (404), sin filtrar que existe.
    // El operario ve los de su gasolinera; el cliente, los suyos. Sin esto,
    // cualquiera podía leer cualquier despacho —y su firma— por ID (IDOR).
    //
    // Falla cerrado: un operario/cliente sin su id de alcance no ve nada, en vez
    // de saltarse el filtro y verlo todo.
    const conditions = [eq(despachos.id, id)];
    if (user.rol === "supervisor") {
      if (!user.gasolinera_id) {
        throw new ForbiddenException("Operario sin gasolinera asignada");
      }
      conditions.push(eq(despachos.gasolinera_id, user.gasolinera_id));
    }
    if (user.rol === "cliente") {
      if (!user.cliente_id) {
        throw new ForbiddenException("Cliente sin empresa asignada");
      }
      conditions.push(eq(despachos.cliente_id, user.cliente_id));
    }

    const result = await this.db.db
      .select({
        despacho: despachos,
        vehiculo: vehiculos,
        piloto: pilotos,
        gasolinera: gasolineras,
        precio: preciosCombustible,
        cliente: clientes,
        operario: { id: operarios.id, nombre: operarios.nombre },
      })
      .from(despachos)
      // leftJoin y no innerJoin: un vale sólo de canecas no tiene vehículo ni
      // piloto, y con innerJoin desaparecería del resultado — un 404 fantasma.
      .leftJoin(vehiculos, eq(despachos.vehiculo_id, vehiculos.id))
      .leftJoin(pilotos, eq(despachos.piloto_id, pilotos.id))
      // leftJoin: los vales anteriores a la Fase 1 no tienen operario.
      .leftJoin(operarios, eq(despachos.operario_id, operarios.id))
      .innerJoin(gasolineras, eq(despachos.gasolinera_id, gasolineras.id))
      .leftJoin(
        preciosCombustible,
        eq(despachos.precio_id, preciosCombustible.id),
      )
      .innerJoin(clientes, eq(despachos.cliente_id, clientes.id))
      .where(and(...conditions))
      .limit(1);

    if (!result.length) throw new NotFoundException("Despacho no encontrado");

    // Los renglones van aparte: son 1:N y traerlos en el mismo select
    // multiplicaría las filas del vale.
    const detalles = await this.db.db
      .select()
      .from(despachoDetalles)
      .where(eq(despachoDetalles.despacho_id, id));

    return { ...result[0], detalles };
  }

  /**
   * Devuelve la firma del despacho desde R2, aplicando el mismo scoping que
   * findOne (un cliente sólo ve las suyas). Se streamea por proxy en vez de dar
   * una URL presignada: la firma prueba que el piloto recibió el combustible y
   * no debe quedar como credencial en una URL (historial, Referer, logs).
   */
  async getFirma(id: string, user: Usuario): Promise<StorageObject> {
    const { despacho } = await this.findOne(id, user); // 404/403 si no es suyo
    if (!despacho.firma_key) {
      throw new NotFoundException("Este despacho no tiene firma");
    }
    const obj = await this.storage.get(despacho.firma_key);
    if (!obj) throw new NotFoundException("Firma no encontrada");
    return obj;
  }

  async create(dto: CreateDespachoDto, user: any) {
    exigirRol(
      user.rol,
      ["supervisor", "admin"],
      "Solo supervisores pueden crear despachos",
    );

    // ── 1. Bloqueo global del sistema ───────────────────────────────────
    const [sysConfig] = await this.db.db
      .select({ sistema_bloqueado: configuracionSistema.sistema_bloqueado })
      .from(configuracionSistema)
      .limit(1);
    exigirSistemaActivo(sysConfig);

    // ── 2. Bloqueo de gasolinera + serie de vale activa ──────────────────
    const [gas] = await this.db.db
      .select({
        bloqueado: gasolineras.bloqueado,
        serie_vale_actual: gasolineras.serie_vale_actual,
      })
      .from(gasolineras)
      .where(eq(gasolineras.id, user.gasolinera_id))
      .limit(1);
    exigirGasolineraOperable(gas);
    // La serie sale de la gasolinera, no del cliente: el operario no la elige.
    const serieVale = gas.serie_vale_actual;

    // ── 2b. Operario de esta gasolinera y activo ─────────────────────────
    const [operario] = await this.db.db
      .select({ id: operarios.id })
      .from(operarios)
      .where(
        and(
          eq(operarios.id, dto.operario_id),
          eq(operarios.gasolinera_id, user.gasolinera_id),
          eq(operarios.activo, true),
        ),
      )
      .limit(1);
    exigirOperarioDeLaGasolinera(operario);

    // ── 3. Bloqueo de cliente ────────────────────────────────────────────
    const [clienteRow] = await this.db.db
      .select()
      .from(clientes)
      .where(eq(clientes.id, dto.cliente_id))
      .limit(1);
    exigirClienteConCredito(clienteRow);

    // ── Renglones del vale ───────────────────────────────────────────────
    const lineas = normalizarRenglones(dto);
    validarParVehiculoPiloto(dto, lineas);

    // ── Restricciones del vehículo ──────────────────────────────────
    // Sólo aplican si el vale toca un vehículo; un despacho a canecas no tiene
    // vehículo al que exigirle horario, productos ni límites.
    let v: typeof vehiculos.$inferSelect | null = null;
    if (dto.vehiculo_id) {
      const [fila] = await this.db.db
        .select()
        .from(vehiculos)
        .where(eq(vehiculos.id, dto.vehiculo_id))
        .limit(1);

      exigirVehiculoHabilitado(fila);
      v = fila;

      validarProductosPermitidos(v, lineas);
    }

    validarHorarioVehiculo(v, new Date());

    // ── Cálculo de precio por renglón (antes de la matriz de límites) ─
    // Cada renglón resuelve su propio precio del día: una caneca puede llevar
    // otro combustible que el vehículo, y el vale debe cobrar cada uno al suyo.
    // Fecha de Guatemala, no UTC: de 18:00 a 23:59 la fecha UTC ya es mañana y
    // el despacho buscaría un precio que nadie cargó todavía.
    const today = fechaGuatemala();
    const renglones = await Promise.all(
      lineas.map(async (l) => {
        const [precioRow] = await this.db.db
          .select()
          .from(preciosCombustible)
          .where(
            and(
              eq(preciosCombustible.gasolinera_id, user.gasolinera_id),
              eq(preciosCombustible.fecha, today),
              eq(preciosCombustible.tipo_combustible, l.tipo_combustible),
            ),
          )
          .limit(1);

        exigirPrecio(precioRow, l.tipo_combustible);

        // El monto se valoriza en quetzales; ver `valorizarRenglon`.
        return {
          ...l,
          precioRow,
          ...valorizarRenglon(l.monto, precioRow.precio_galon),
        };
      }),
    );

    const {
      montoEstimado,
      galonesEstimado,
      montoTotal,
      montoVehiculo,
      galonesVehiculo,
    } = totalesDespacho(renglones);
    const renglonesVehiculo = renglones.filter((r) => r.renglon === "vehiculo");

    const num = (x: unknown) => (x != null ? parseFloat(String(x)) : null);

    // ── 4. Límites de gasto a nivel cuenta ──────────────────────────
    const needsClienteAggregate =
      clienteRow.limite_monto_dia != null ||
      clienteRow.limite_monto_semana != null ||
      clienteRow.limite_monto_mes != null;

    if (needsClienteAggregate) {
      const [cAgg] = await this.db.db
        .select({
          monto_dia: sql<number>`COALESCE(SUM(${despachos.monto_total}::numeric) FILTER (WHERE (${despachos.despachado_at} - INTERVAL '6 hours')::date = (NOW() - INTERVAL '6 hours')::date), 0)`,
          monto_semana: sql<number>`COALESCE(SUM(${despachos.monto_total}::numeric) FILTER (WHERE date_trunc('week', ${despachos.despachado_at} - INTERVAL '6 hours') = date_trunc('week', NOW() - INTERVAL '6 hours')), 0)`,
          monto_mes: sql<number>`COALESCE(SUM(${despachos.monto_total}::numeric) FILTER (WHERE date_trunc('month', ${despachos.despachado_at} - INTERVAL '6 hours') = date_trunc('month', NOW() - INTERVAL '6 hours')), 0)`,
        })
        .from(despachos)
        .where(eq(despachos.cliente_id, dto.cliente_id));

      const clienteChecks: Array<[number | null, number, string]> = [
        [
          num(clienteRow.limite_monto_dia),
          parseFloat(String(cAgg.monto_dia)),
          "Límite diario de la cuenta superado",
        ],
        [
          num(clienteRow.limite_monto_semana),
          parseFloat(String(cAgg.monto_semana)),
          "Límite semanal de la cuenta superado",
        ],
        [
          num(clienteRow.limite_monto_mes),
          parseFloat(String(cAgg.monto_mes)),
          "Límite mensual de la cuenta superado",
        ],
      ];
      for (const [limite, consumido, msg] of clienteChecks) {
        if (limite != null && consumido + montoEstimado > limite) {
          throw new ForbiddenException(msg);
        }
      }
    }

    // ── Límites por transacción (sin query) ──────────────────────────
    // Miden el renglón del vehículo, no el total del vale.
    const lmt = num(v?.limite_monto_transaccion);
    if (lmt != null && montoVehiculo > lmt)
      throw new ForbiddenException(
        `Monto por transacción supera el límite (Q${lmt.toFixed(2)})`,
      );
    const lvt = num(v?.limite_volumen_transaccion);
    if (lvt != null && galonesVehiculo > lvt)
      throw new ForbiddenException(
        `Volumen por transacción supera el límite (${lvt.toFixed(2)} gal)`,
      );

    // ── Límites acumulados (una query con FILTER) ────────────────────
    const needsAggregate =
      v != null &&
      (v.limite_monto_dia != null ||
        v.limite_monto_semana != null ||
        v.limite_monto_mes != null ||
        v.limite_volumen_dia != null ||
        v.limite_volumen_semana != null ||
        v.limite_volumen_mes != null ||
        v.limite_trans_dia != null ||
        v.limite_trans_semana != null ||
        v.limite_trans_mes != null);
    if (needsAggregate && v) {
      // Monto y volumen salen de `despacho_detalles` filtrando el renglón del
      // vehículo: sumar `despachos.monto_total` incluiría las canecas del mismo
      // vale y le comería el cupo al vehículo. Las transacciones sí se cuentan
      // sobre el header, porque un vale mixto es UNA transacción.
      //
      // La migración rellenó un renglón 'vehiculo' por cada despacho anterior,
      // así que el histórico entra completo en este agregado.
      const [agg] = await this.db.db
        .select({
          monto_dia: sql<number>`COALESCE(SUM(${despachoDetalles.monto}::numeric) FILTER (WHERE (${despachos.despachado_at} - INTERVAL '6 hours')::date = (NOW() - INTERVAL '6 hours')::date), 0)`,
          monto_semana: sql<number>`COALESCE(SUM(${despachoDetalles.monto}::numeric) FILTER (WHERE date_trunc('week', ${despachos.despachado_at} - INTERVAL '6 hours') = date_trunc('week', NOW() - INTERVAL '6 hours')), 0)`,
          monto_mes: sql<number>`COALESCE(SUM(${despachoDetalles.monto}::numeric) FILTER (WHERE date_trunc('month', ${despachos.despachado_at} - INTERVAL '6 hours') = date_trunc('month', NOW() - INTERVAL '6 hours')), 0)`,
          vol_dia: sql<number>`COALESCE(SUM(${despachoDetalles.galones}::numeric) FILTER (WHERE (${despachos.despachado_at} - INTERVAL '6 hours')::date = (NOW() - INTERVAL '6 hours')::date), 0)`,
          vol_semana: sql<number>`COALESCE(SUM(${despachoDetalles.galones}::numeric) FILTER (WHERE date_trunc('week', ${despachos.despachado_at} - INTERVAL '6 hours') = date_trunc('week', NOW() - INTERVAL '6 hours')), 0)`,
          vol_mes: sql<number>`COALESCE(SUM(${despachoDetalles.galones}::numeric) FILTER (WHERE date_trunc('month', ${despachos.despachado_at} - INTERVAL '6 hours') = date_trunc('month', NOW() - INTERVAL '6 hours')), 0)`,
          trans_dia: sql<number>`COUNT(DISTINCT ${despachos.id}) FILTER (WHERE (${despachos.despachado_at} - INTERVAL '6 hours')::date = (NOW() - INTERVAL '6 hours')::date)`,
          trans_semana: sql<number>`COUNT(DISTINCT ${despachos.id}) FILTER (WHERE date_trunc('week', ${despachos.despachado_at} - INTERVAL '6 hours') = date_trunc('week', NOW() - INTERVAL '6 hours'))`,
          trans_mes: sql<number>`COUNT(DISTINCT ${despachos.id}) FILTER (WHERE date_trunc('month', ${despachos.despachado_at} - INTERVAL '6 hours') = date_trunc('month', NOW() - INTERVAL '6 hours'))`,
        })
        .from(despachoDetalles)
        .innerJoin(despachos, eq(despachoDetalles.despacho_id, despachos.id))
        .where(
          and(
            eq(despachos.vehiculo_id, dto.vehiculo_id!),
            eq(despachoDetalles.renglon, "vehiculo"),
          ),
        );

      const checks: Array<[number | null, number, number, string]> = [
        [
          num(v.limite_monto_dia),
          parseFloat(String(agg.monto_dia)),
          montoVehiculo,
          `Límite diario de monto superado`,
        ],
        [
          num(v.limite_monto_semana),
          parseFloat(String(agg.monto_semana)),
          montoVehiculo,
          `Límite semanal de monto superado`,
        ],
        [
          num(v.limite_monto_mes),
          parseFloat(String(agg.monto_mes)),
          montoVehiculo,
          `Límite mensual de monto superado`,
        ],
        [
          num(v.limite_volumen_dia),
          parseFloat(String(agg.vol_dia)),
          galonesVehiculo,
          `Límite diario de volumen superado`,
        ],
        [
          num(v.limite_volumen_semana),
          parseFloat(String(agg.vol_semana)),
          galonesVehiculo,
          `Límite semanal de volumen superado`,
        ],
        [
          num(v.limite_volumen_mes),
          parseFloat(String(agg.vol_mes)),
          galonesVehiculo,
          `Límite mensual de volumen superado`,
        ],
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

    // ── 10. Validación de kilometraje ────────────────────────────────────
    // Sólo tiene sentido con vehículo: una caneca no trae odómetro.
    if (dto.kilometraje && dto.vehiculo_id) {
      const [lastKmRow] = await this.db.db
        .select({ max_km: sql<number>`MAX(${despachos.kilometraje}::numeric)` })
        .from(despachos)
        .where(eq(despachos.vehiculo_id, dto.vehiculo_id));

      const maxKm =
        lastKmRow?.max_km != null ? parseFloat(String(lastKmRow.max_km)) : null;
      if (maxKm !== null && parseFloat(dto.kilometraje) <= maxKm) {
        throw new ForbiddenException("Inconsistencia de kilometraje detectada");
      }
    }

    // Firma a R2 antes de abrir la transacción (ver subirFirma). Si toda la
    // validación de arriba pasó pero la subida falla, no se creó ningún despacho.
    const firmaKey = await this.subirFirma(
      dto.firma_piloto_base64,
      user.gasolinera_id,
    );

    return this.db.db.transaction(async (tx) => {
      // Advisory lock por gasolinera+serie para serializar la asignación de numero_vale.
      // pg_advisory_xact_lock toma un bigint — usamos hashtext de la clave compuesta.
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${user.gasolinera_id} || ':' || ${serieVale}))`,
      );

      // Calcular el siguiente número de vale dentro del bloqueo
      const [{ nextVal }] = await tx
        .select({ nextVal: sql<number>`COUNT(*)::int + 1` })
        .from(despachos)
        .where(
          and(
            eq(despachos.gasolinera_id, user.gasolinera_id),
            eq(despachos.serie_vale, serieVale),
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
            operario_id: dto.operario_id,
            // El header guarda el precio del renglón principal para que los
            // lectores viejos sigan resolviendo un tipo de combustible.
            precio_id: (renglonesVehiculo[0] ?? renglones[0]).precioRow.id,
            numero_vale: numeroVale,
            serie_vale: serieVale,
            turno: dto.turno,
            bomba_numero: dto.bomba_numero,
            kilometraje: dto.kilometraje,
            galones: galonesEstimado.toFixed(3),
            monto_total: montoTotal,
            firma_key: firmaKey,
          })
          .returning();
      } catch (e: any) {
        if (e?.code === "23505") {
          throw new ConflictException(
            `El vale ${serieVale}-${numeroVale} ya existe para esta gasolinera`,
          );
        }
        throw e;
      }

      await tx.insert(despachoDetalles).values(
        renglones.map((r) => ({
          despacho_id: despacho.id,
          renglon: r.renglon,
          tipo_combustible: r.tipo_combustible,
          precio_id: r.precioRow.id,
          monto: r.monto.toFixed(3),
          galones: r.galones.toFixed(3),
        })),
      );

      // UN solo débito por la suma, aunque el vale tenga varios renglones: así
      // se preserva el 1:1 con el despacho y el estado de cuenta sigue cuadrando.
      await tx.insert(movimientosSaldo).values({
        cliente_id: dto.cliente_id,
        gasolinera_id: user.gasolinera_id,
        despacho_id: despacho.id,
        tipo: "debito",
        monto: montoTotal,
        descripcion: `Despacho ${resumenRenglones(renglones)} - Vale ${serieVale}-${numeroVale}`,
      });

      await tx
        .update(saldosCliente)
        .set({
          saldo_actual: sql`saldo_actual - ${montoTotal}::numeric`,
          updated_at: new Date(),
        })
        .where(eq(saldosCliente.cliente_id, dto.cliente_id));

      // Los renglones vuelven con el vale: el frontend los necesita para
      // imprimirlo sin una segunda vuelta a la API.
      return {
        ...despacho,
        detalles: renglones.map((r) => ({
          renglon: r.renglon,
          tipo_combustible: r.tipo_combustible,
          monto: r.monto.toFixed(3),
          galones: r.galones.toFixed(3),
          precio_galon: r.precioRow.precio_galon,
        })),
      };
    });
  }

  async update(id: string, dto: UpdateDespachoDto) {
    // Ruta admin-only (ve todo), así que sólo hace falta confirmar existencia,
    // sin el scoping ni los joins de findOne.
    const [existe] = await this.db.db
      .select({ id: despachos.id })
      .from(despachos)
      .where(eq(despachos.id, id))
      .limit(1);
    if (!existe) throw new NotFoundException("Despacho no encontrado");

    const [row] = await this.db.db
      .update(despachos)
      .set(dto)
      .where(eq(despachos.id, id))
      .returning();
    return row;
  }

  async getConsumoHoy(
    vehiculoId: string,
    clienteId?: string,
    gasolineraId?: string,
    user?: { rol: string; cliente_id?: string | null },
  ) {
    const n = (x: unknown) => (x != null ? parseFloat(String(x)) : null);

    const [v] = await this.db.db
      .select()
      .from(vehiculos)
      .where(eq(vehiculos.id, vehiculoId))
      .limit(1);
    if (!v) throw new NotFoundException("Vehículo no encontrado");
    // Alcance fail-closed: un cliente sólo consulta vehículos propios.
    if (
      user?.rol === "cliente" &&
      (!user.cliente_id || v.cliente_id !== user.cliente_id)
    )
      throw new NotFoundException("Vehículo no encontrado");

    // Sistema
    const [sysConfig] = await this.db.db
      .select({ sistema_bloqueado: configuracionSistema.sistema_bloqueado })
      .from(configuracionSistema)
      .limit(1);

    // Gasolinera
    let gasolinera_bloqueado = false;
    if (gasolineraId) {
      const [gasRow] = await this.db.db
        .select({ bloqueado: gasolineras.bloqueado })
        .from(gasolineras)
        .where(eq(gasolineras.id, gasolineraId))
        .limit(1);
      gasolinera_bloqueado = gasRow?.bloqueado ?? false;
    }

    // Cliente
    let cliente_bloqueado = false;
    let cliente_credito_bloqueado = false;
    let clienteLimites = {
      dia: null as number | null,
      semana: null as number | null,
      mes: null as number | null,
    };
    let clienteConsumo = { dia: 0, semana: 0, mes: 0 };
    // Un cliente sólo consulta su propia cuenta: se ignora el cliente_id del query.
    const resolvedClienteId =
      user?.rol === "cliente" ? v.cliente_id : (clienteId ?? v.cliente_id);

    const [cliRow] = await this.db.db
      .select()
      .from(clientes)
      .where(eq(clientes.id, resolvedClienteId))
      .limit(1);

    if (cliRow) {
      cliente_bloqueado = cliRow.bloqueado ?? false;
      cliente_credito_bloqueado = cliRow.credito_bloqueado ?? false;
      clienteLimites = {
        dia: n(cliRow.limite_monto_dia),
        semana: n(cliRow.limite_monto_semana),
        mes: n(cliRow.limite_monto_mes),
      };
      if (
        clienteLimites.dia != null ||
        clienteLimites.semana != null ||
        clienteLimites.mes != null
      ) {
        const [cAgg] = await this.db.db
          .select({
            monto_dia: sql<number>`COALESCE(SUM(${despachos.monto_total}::numeric) FILTER (WHERE (${despachos.despachado_at} - INTERVAL '6 hours')::date = (NOW() - INTERVAL '6 hours')::date), 0)`,
            monto_semana: sql<number>`COALESCE(SUM(${despachos.monto_total}::numeric) FILTER (WHERE date_trunc('week', ${despachos.despachado_at} - INTERVAL '6 hours') = date_trunc('week', NOW() - INTERVAL '6 hours')), 0)`,
            monto_mes: sql<number>`COALESCE(SUM(${despachos.monto_total}::numeric) FILTER (WHERE date_trunc('month', ${despachos.despachado_at} - INTERVAL '6 hours') = date_trunc('month', NOW() - INTERVAL '6 hours')), 0)`,
          })
          .from(despachos)
          .where(eq(despachos.cliente_id, resolvedClienteId));
        clienteConsumo = {
          dia: parseFloat(String(cAgg.monto_dia)),
          semana: parseFloat(String(cAgg.monto_semana)),
          mes: parseFloat(String(cAgg.monto_mes)),
        };
      }
    }

    // Vehículo aggregate
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

    // Horario
    const { dayName, totalMinutes } = getGuatemalaTime();
    void dayName; // used only in create() for day-of-week check; included here for reference
    const dentroDeHorario = (() => {
      if (!v.hora_inicio || !v.hora_fin) return true;
      return (
        totalMinutes >= aMinutos(v.hora_inicio) &&
        totalMinutes <= aMinutos(v.hora_fin)
      );
    })();
    const minutosRestantes = (() => {
      if (!v.hora_fin || !dentroDeHorario) return 0;
      return Math.max(0, aMinutos(v.hora_fin) - totalMinutes);
    })();

    return {
      sistema_bloqueado: sysConfig?.sistema_bloqueado ?? false,
      gasolinera_bloqueado,
      cliente_bloqueado,
      cliente_credito_bloqueado,
      cliente_limites: clienteLimites,
      cliente_consumo: clienteConsumo,
      bloqueado: v.bloqueado ?? false,
      productos_permitidos: v.productos_permitidos ?? null,
      horario: {
        dias_permitidos: v.dias_permitidos ?? null,
        hora_inicio: v.hora_inicio ?? null,
        hora_fin: v.hora_fin ?? null,
        dentro_de_horario: dentroDeHorario,
        minutos_restantes: minutosRestantes,
      },
      limites: {
        monto: {
          transaccion: n(v.limite_monto_transaccion),
          dia: n(v.limite_monto_dia),
          semana: n(v.limite_monto_semana),
          mes: n(v.limite_monto_mes),
        },
        volumen: {
          transaccion: n(v.limite_volumen_transaccion),
          dia: n(v.limite_volumen_dia),
          semana: n(v.limite_volumen_semana),
          mes: n(v.limite_volumen_mes),
        },
        transacciones: {
          dia: v.limite_trans_dia ?? null,
          semana: v.limite_trans_semana ?? null,
          mes: v.limite_trans_mes ?? null,
        },
      },
      consumo: {
        monto: {
          dia: parseFloat(String(agg.monto_dia)),
          semana: parseFloat(String(agg.monto_semana)),
          mes: parseFloat(String(agg.monto_mes)),
        },
        volumen: {
          dia: parseFloat(String(agg.vol_dia)),
          semana: parseFloat(String(agg.vol_semana)),
          mes: parseFloat(String(agg.vol_mes)),
        },
        transacciones: {
          dia: parseInt(String(agg.trans_dia)),
          semana: parseInt(String(agg.trans_semana)),
          mes: parseInt(String(agg.trans_mes)),
        },
      },
    };
  }
}
