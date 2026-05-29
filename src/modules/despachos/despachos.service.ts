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
    const montoTotal = (
      parseFloat(dto.galones) * parseFloat(precioRow.precio_galon)
    ).toFixed(3);

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
}
