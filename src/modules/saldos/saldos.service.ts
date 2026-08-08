import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, desc, eq, sql } from "drizzle-orm";
import { DbService } from "../../db/db.service";
import {
  clientes,
  cuadres,
  movimientosSaldo,
  saldosCliente,
} from "../../db/schema";
import { CreateAbonoDto } from "./dto/create-abono.dto";
import { CreateCuadreDto } from "./dto/create-cuadre.dto";
import { QueryCuadresDto } from "./dto/query-cuadres.dto";
import { QueryEstadoCuentaDto } from "./dto/query-estado-cuenta.dto";
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

  /**
   * Estado de cuenta de un período.
   *
   * El saldo inicial se calcula sumando **todo** el ledger anterior a
   * `fecha_desde`, no leyendo `saldos_cliente`: esa columna guarda el saldo de
   * hoy, y para un período pasado daría un arrastre equivocado. La identidad
   * que debe cumplirse siempre es
   * `saldo_inicial + abonos − débitos = saldo_final`.
   */
  async getEstadoCuenta(clienteId: string, query: QueryEstadoCuentaDto) {
    const [cliente] = await this.db.db
      .select()
      .from(clientes)
      .where(eq(clientes.id, clienteId))
      .limit(1);
    if (!cliente) throw new NotFoundException("Cliente no encontrado");

    const { fecha_desde, fecha_hasta } = query;

    // El monto va siempre positivo; el signo lo pone `tipo`.
    const neto = sql<string>`COALESCE(SUM(
      CASE WHEN ${movimientosSaldo.tipo} = 'credito'
           THEN ${movimientosSaldo.monto}
           ELSE -${movimientosSaldo.monto} END
    ), 0)`;

    const [previo] = await this.db.db
      .select({ saldo: neto })
      .from(movimientosSaldo)
      .where(
        and(
          eq(movimientosSaldo.cliente_id, clienteId),
          fecha_desde
            ? sql`${movimientosSaldo.created_at}::date < ${fecha_desde}::date`
            : sql`false`,
        ),
      );

    const condicionesRango = [eq(movimientosSaldo.cliente_id, clienteId)];
    if (fecha_desde)
      condicionesRango.push(
        sql`${movimientosSaldo.created_at}::date >= ${fecha_desde}::date`,
      );
    if (fecha_hasta)
      condicionesRango.push(
        sql`${movimientosSaldo.created_at}::date <= ${fecha_hasta}::date`,
      );

    const movimientos = await this.db.db
      .select()
      .from(movimientosSaldo)
      .where(and(...condicionesRango))
      .orderBy(movimientosSaldo.created_at);

    const suma = (tipo: string) =>
      movimientos
        .filter((m) => m.tipo === tipo)
        .reduce((acc, m) => acc + parseFloat(m.monto), 0);

    const saldoInicial = parseFloat(previo?.saldo ?? "0");
    const abonos = suma("credito");
    const debitos = suma("debito");

    return {
      cliente: {
        id: cliente.id,
        nombre: cliente.nombre,
        nit: cliente.nit,
        credito_bloqueado: cliente.credito_bloqueado,
      },
      periodo: {
        fecha_desde: fecha_desde ?? null,
        fecha_hasta: fecha_hasta ?? null,
      },
      saldo_inicial: saldoInicial.toFixed(3),
      total_abonos: abonos.toFixed(3),
      total_debitos: debitos.toFixed(3),
      saldo_final: (saldoInicial + abonos - debitos).toFixed(3),
      movimientos,
    };
  }

  async createAbono(dto: CreateAbonoDto) {
    if (parseFloat(dto.monto) <= 0) {
      throw new BadRequestException("El monto debe ser mayor a cero");
    }

    return this.db.db.transaction(async (tx) => {
      const [saldo] = await tx
        .select()
        .from(saldosCliente)
        .where(eq(saldosCliente.cliente_id, dto.cliente_id))
        .limit(1);

      if (!saldo) throw new NotFoundException("Cliente no encontrado");

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
