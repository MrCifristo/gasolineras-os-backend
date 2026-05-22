import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, desc, eq, sql } from "drizzle-orm";
import { DbService } from "../../db/db.service";
import { cuadres, movimientosSaldo, saldosCliente } from "../../db/schema";
import { CreateAbonoDto } from "./dto/create-abono.dto";
import { CreateCuadreDto } from "./dto/create-cuadre.dto";
import { QueryCuadresDto } from "./dto/query-cuadres.dto";
import { QueryMovimientosDto } from "./dto/query-movimientos.dto";

@Injectable()
export class SaldosService {
  constructor(private db: DbService) {}

  async getClienteSaldo(clienteId: string) {
    const [saldo] = await this.db.db
      .select()
      .from(saldosCliente)
      .where(eq(saldosCliente.cliente_id, clienteId))
      .limit(1);

    if (!saldo) throw new NotFoundException("Cliente sin saldo registrado");

    const movimientos = await this.db.db
      .select()
      .from(movimientosSaldo)
      .where(eq(movimientosSaldo.cliente_id, clienteId))
      .orderBy(desc(movimientosSaldo.created_at))
      .limit(20);

    return { saldo_actual: saldo.saldo_actual, movimientos };
  }

  async getClienteMovimientos(clienteId: string, query: QueryMovimientosDto) {
    const [saldo] = await this.db.db
      .select()
      .from(saldosCliente)
      .where(eq(saldosCliente.cliente_id, clienteId))
      .limit(1);

    if (!saldo) throw new NotFoundException("Cliente sin saldo registrado");

    const { page = 1, limit = 20, fecha_desde, fecha_hasta, tipo } = query;
    const conditions: any[] = [eq(movimientosSaldo.cliente_id, clienteId)];

    if (fecha_desde)
      conditions.push(
        sql`${movimientosSaldo.created_at}::date >= ${fecha_desde}::date`,
      );
    if (fecha_hasta)
      conditions.push(
        sql`${movimientosSaldo.created_at}::date <= ${fecha_hasta}::date`,
      );
    if (tipo) conditions.push(eq(movimientosSaldo.tipo, tipo));

    return this.db.db
      .select()
      .from(movimientosSaldo)
      .where(and(...conditions))
      .orderBy(desc(movimientosSaldo.created_at))
      .limit(limit)
      .offset((page - 1) * limit);
  }

  async createAbono(dto: CreateAbonoDto) {
    if (parseFloat(dto.monto) <= 0) {
      throw new BadRequestException("El monto debe ser mayor a cero");
    }

    const [saldo] = await this.db.db
      .select()
      .from(saldosCliente)
      .where(eq(saldosCliente.cliente_id, dto.cliente_id))
      .limit(1);

    if (!saldo) throw new NotFoundException("Cliente no encontrado");

    return this.db.db.transaction(async (tx) => {
      const [movimiento] = await tx
        .insert(movimientosSaldo)
        .values({
          cliente_id: dto.cliente_id,
          gasolinera_id: dto.gasolinera_id,
          tipo: "credito",
          monto: dto.monto,
          descripcion: dto.descripcion ?? null,
        })
        .returning();

      await tx
        .update(saldosCliente)
        .set({
          saldo_actual: sql`saldo_actual + ${dto.monto}::numeric`,
          updated_at: new Date(),
        })
        .where(eq(saldosCliente.cliente_id, dto.cliente_id));

      return movimiento;
    });
  }

  async createCuadre(dto: CreateCuadreDto, userId: string) {
    if (dto.tipo === "cliente" && !dto.cliente_id) {
      throw new BadRequestException(
        'cliente_id es requerido cuando tipo es "cliente"',
      );
    }

    const [cuadre] = await this.db.db
      .insert(cuadres)
      .values({
        tipo: dto.tipo,
        gasolinera_id: dto.gasolinera_id,
        cliente_id: dto.tipo === "cliente" ? dto.cliente_id : null,
        fecha_desde: dto.fecha_desde,
        fecha_hasta: dto.fecha_hasta,
        cuadrado_por: userId,
        notas: dto.notas ?? null,
      })
      .returning();

    return cuadre;
  }

  async findCuadres(query: QueryCuadresDto) {
    const conditions: any[] = [];

    if (query.tipo) conditions.push(eq(cuadres.tipo, query.tipo));
    if (query.cliente_id)
      conditions.push(eq(cuadres.cliente_id, query.cliente_id));
    if (query.gasolinera_id)
      conditions.push(eq(cuadres.gasolinera_id, query.gasolinera_id));
    if (query.fecha_desde)
      conditions.push(
        sql`${cuadres.fecha_hasta} >= ${query.fecha_desde}::date`,
      );
    if (query.fecha_hasta)
      conditions.push(
        sql`${cuadres.fecha_desde} <= ${query.fecha_hasta}::date`,
      );

    return this.db.db
      .select()
      .from(cuadres)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(cuadres.created_at));
  }
}
