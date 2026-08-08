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
  configuracionSistema,
  usuarios,
} from "../../db/schema";
import { CreateDespachoDto } from "./dto/create-despacho.dto";
import { UpdateDespachoDto } from "./dto/update-despacho.dto";
import { StorageService, StorageObject } from "../../storage/storage.service";

type Usuario = typeof usuarios.$inferSelect;

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
      .where(and(...conditions))
      .limit(1);

    if (!result.length) throw new NotFoundException("Despacho no encontrado");
    return result[0];
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
    if (user.rol !== "supervisor" && user.rol !== "admin") {
      throw new ForbiddenException("Solo supervisores pueden crear despachos");
    }

    // ── 1. Bloqueo global del sistema ───────────────────────────────────
    const [sysConfig] = await this.db.db
      .select({ sistema_bloqueado: configuracionSistema.sistema_bloqueado })
      .from(configuracionSistema)
      .limit(1);
    if (sysConfig?.sistema_bloqueado) {
      throw new ForbiddenException(
        "Sistema suspendido — contacte al administrador",
      );
    }

    // ── 2. Bloqueo de gasolinera + serie de vale activa ──────────────────
    const [gas] = await this.db.db
      .select({
        bloqueado: gasolineras.bloqueado,
        serie_vale_actual: gasolineras.serie_vale_actual,
      })
      .from(gasolineras)
      .where(eq(gasolineras.id, user.gasolinera_id))
      .limit(1);
    if (!gas) throw new NotFoundException("Gasolinera no encontrada");
    if (gas.bloqueado) {
      throw new ForbiddenException(
        "Gasolinera bloqueada — contacte al administrador",
      );
    }
    // La serie sale de la gasolinera, no del cliente: el operario no la elige.
    const serieVale = gas.serie_vale_actual;

    // ── 3. Bloqueo de cliente ────────────────────────────────────────────
    const [clienteRow] = await this.db.db
      .select()
      .from(clientes)
      .where(eq(clientes.id, dto.cliente_id))
      .limit(1);
    if (!clienteRow) throw new NotFoundException("Cliente no encontrado");
    if (clienteRow.bloqueado) {
      throw new ForbiddenException("Cuenta bloqueada por el cliente");
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

    // El operario teclea el monto en quetzales; los galones se derivan del
    // precio autoritativo del servidor. Así el total del vale es exactamente lo
    // que paga el cliente, sin desajustes de redondeo.
    const precioRow = precio[0];
    const montoEstimado = parseFloat(dto.monto);
    const montoTotal = montoEstimado.toFixed(3);
    const galonesEstimado = montoEstimado / parseFloat(precioRow.precio_galon);
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
        [
          num(v.limite_monto_dia),
          parseFloat(String(agg.monto_dia)),
          montoEstimado,
          `Límite diario de monto superado`,
        ],
        [
          num(v.limite_monto_semana),
          parseFloat(String(agg.monto_semana)),
          montoEstimado,
          `Límite semanal de monto superado`,
        ],
        [
          num(v.limite_monto_mes),
          parseFloat(String(agg.monto_mes)),
          montoEstimado,
          `Límite mensual de monto superado`,
        ],
        [
          num(v.limite_volumen_dia),
          parseFloat(String(agg.vol_dia)),
          galonesEstimado,
          `Límite diario de volumen superado`,
        ],
        [
          num(v.limite_volumen_semana),
          parseFloat(String(agg.vol_semana)),
          galonesEstimado,
          `Límite semanal de volumen superado`,
        ],
        [
          num(v.limite_volumen_mes),
          parseFloat(String(agg.vol_mes)),
          galonesEstimado,
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
    if (dto.kilometraje) {
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
            precio_id: precioRow.id,
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

      await tx.insert(movimientosSaldo).values({
        cliente_id: dto.cliente_id,
        gasolinera_id: user.gasolinera_id,
        despacho_id: despacho.id,
        tipo: "debito",
        monto: montoTotal,
        descripcion: `Despacho ${dto.tipo_combustible} ${galonesEstimado.toFixed(3)} galones - Vale ${serieVale}-${numeroVale}`,
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
  ) {
    const n = (x: unknown) => (x != null ? parseFloat(String(x)) : null);

    const [v] = await this.db.db
      .select()
      .from(vehiculos)
      .where(eq(vehiculos.id, vehiculoId))
      .limit(1);
    if (!v) throw new NotFoundException("Vehículo no encontrado");

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
    let clienteLimites = {
      dia: null as number | null,
      semana: null as number | null,
      mes: null as number | null,
    };
    let clienteConsumo = { dia: 0, semana: 0, mes: 0 };
    const resolvedClienteId = clienteId ?? v.cliente_id;

    const [cliRow] = await this.db.db
      .select()
      .from(clientes)
      .where(eq(clientes.id, resolvedClienteId))
      .limit(1);

    if (cliRow) {
      cliente_bloqueado = cliRow.bloqueado ?? false;
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
        totalMinutes >= hhmm(v.hora_inicio) && totalMinutes <= hhmm(v.hora_fin)
      );
    })();
    const minutosRestantes = (() => {
      if (!v.hora_fin || !dentroDeHorario) return 0;
      return Math.max(0, hhmm(v.hora_fin) - totalMinutes);
    })();

    return {
      sistema_bloqueado: sysConfig?.sistema_bloqueado ?? false,
      gasolinera_bloqueado,
      cliente_bloqueado,
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
