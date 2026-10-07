import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { DbService } from "../../db/db.service";
import {
  clientes,
  gasolineras,
  inventarioMovimientos,
  movimientosSaldo,
  productos,
  saldosCliente,
  ventaInsumoDetalles,
  ventasInsumos,
} from "../../db/schema";
import { CreateVentaInsumoDto, FormaPago } from "./dto/create-venta-insumo.dto";
import { fechaGtSql } from "../../common/hora-guatemala";
import {
  exigirClienteConCredito,
  exigirGasolineraOperable,
  exigirRol,
} from "../../common/bloqueos.reglas";
import {
  exigirProductosSinRepetir,
  validarFormaPago,
  valorizarRenglonVenta,
} from "./ventas-insumos.reglas";

export interface FiltrosVenta {
  gasolinera_id?: string;
  cliente_id?: string;
  forma_pago?: string;
  fecha_desde?: string;
  fecha_hasta?: string;
}

@Injectable()
export class VentasInsumosService {
  constructor(private readonly db: DbService) {}

  async findAll(filtros: FiltrosVenta, user: any) {
    const condiciones: any[] = [];

    if (user.rol === "cliente" && !user.cliente_id) return [];

    // Mismo scoping que despachos: el supervisor ve su estación, el cliente
    // sólo lo suyo. Sin esto, cualquiera lee las ventas de cualquier cuenta.
    if (user.rol === "supervisor")
      condiciones.push(eq(ventasInsumos.gasolinera_id, user.gasolinera_id));
    if (user.rol === "cliente")
      condiciones.push(eq(ventasInsumos.cliente_id, user.cliente_id));

    if (filtros.gasolinera_id)
      condiciones.push(eq(ventasInsumos.gasolinera_id, filtros.gasolinera_id));
    if (filtros.cliente_id)
      condiciones.push(eq(ventasInsumos.cliente_id, filtros.cliente_id));
    if (filtros.forma_pago)
      condiciones.push(
        sql`${ventasInsumos.forma_pago} = ${filtros.forma_pago}`,
      );
    if (filtros.fecha_desde)
      condiciones.push(
        sql`${fechaGtSql(ventasInsumos.vendido_at)} >= ${filtros.fecha_desde}::date`,
      );
    if (filtros.fecha_hasta)
      condiciones.push(
        sql`${fechaGtSql(ventasInsumos.vendido_at)} <= ${filtros.fecha_hasta}::date`,
      );

    return this.db.db
      .select()
      .from(ventasInsumos)
      .where(condiciones.length ? and(...condiciones) : undefined)
      .orderBy(desc(ventasInsumos.vendido_at))
      .limit(100);
  }

  async findOne(id: string, user: any) {
    const condiciones = [eq(ventasInsumos.id, id)];
    if (user.rol === "supervisor") {
      if (!user.gasolinera_id)
        throw new ForbiddenException("Supervisor sin gasolinera asignada");
      condiciones.push(eq(ventasInsumos.gasolinera_id, user.gasolinera_id));
    }
    if (user.rol === "cliente") {
      if (!user.cliente_id)
        throw new ForbiddenException("Cliente sin empresa asignada");
      condiciones.push(eq(ventasInsumos.cliente_id, user.cliente_id));
    }

    const [venta] = await this.db.db
      .select()
      .from(ventasInsumos)
      .where(and(...condiciones))
      .limit(1);
    if (!venta) throw new NotFoundException("Venta no encontrada");

    const detalles = await this.db.db
      .select()
      .from(ventaInsumoDetalles)
      .where(eq(ventaInsumoDetalles.venta_id, id));

    return { ...venta, detalles };
  }

  /**
   * Registra una venta de insumos.
   *
   * Espeja la transacción de despachos: advisory lock por gasolinera+serie para
   * serializar la numeración, y todo el efecto (venta, renglones, stock, kardex
   * y, si aplica, el débito de saldo) dentro de la misma transacción. La serie
   * de vale es propia, no la de combustible.
   */
  async create(dto: CreateVentaInsumoDto, user: any) {
    exigirRol(
      user.rol,
      ["supervisor", "admin"],
      "Solo supervisores pueden vender insumos",
    );

    validarFormaPago(dto);

    const [gas] = await this.db.db
      .select({
        bloqueado: gasolineras.bloqueado,
        serie_vale_actual: gasolineras.serie_vale_actual,
      })
      .from(gasolineras)
      .where(eq(gasolineras.id, user.gasolinera_id))
      .limit(1);
    exigirGasolineraOperable(gas);
    const serieVale = gas.serie_vale_actual;

    if (dto.cliente_id) {
      const [cliente] = await this.db.db
        .select()
        .from(clientes)
        .where(eq(clientes.id, dto.cliente_id))
        .limit(1);
      // Cargar insumos a la cuenta también es consumir crédito.
      exigirClienteConCredito(cliente);
    }

    const ids = dto.detalles.map((d) => d.producto_id);
    exigirProductosSinRepetir(ids);

    return this.db.db.transaction(async (tx) => {
      // Se bloquean las filas de producto antes de leer el stock: sin esto, dos
      // ventas concurrentes del último artículo pasarían las dos.
      const filas = await tx
        .select()
        .from(productos)
        .where(inArray(productos.id, ids))
        .for("update");

      const porId = new Map(filas.map((p) => [p.id, p]));

      const renglones = dto.detalles.map((d) =>
        valorizarRenglonVenta(porId.get(d.producto_id), d),
      );

      const montoTotal = renglones.reduce((acc, r) => acc + r.subtotal, 0);

      // Numeración serializada por gasolinera+serie, en su propia llave de
      // advisory lock para no contender con la de combustible.
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${user.gasolinera_id} || ':INSUMOS:' || ${serieVale}))`,
      );

      const [{ nextVal }] = await tx
        .select({ nextVal: sql<number>`COUNT(*)::int + 1` })
        .from(ventasInsumos)
        .where(
          and(
            eq(ventasInsumos.gasolinera_id, user.gasolinera_id),
            eq(ventasInsumos.serie_vale, serieVale),
          ),
        );
      const numeroVale = String(nextVal).padStart(6, "0");

      let venta: typeof ventasInsumos.$inferSelect;
      try {
        [venta] = await tx
          .insert(ventasInsumos)
          .values({
            gasolinera_id: user.gasolinera_id,
            usuario_id: user.id,
            operario_id: dto.operario_id ?? null,
            cliente_id: dto.cliente_id ?? null,
            forma_pago: dto.forma_pago,
            numero_vale: numeroVale,
            serie_vale: serieVale,
            bomba_numero: dto.bomba_numero ?? null,
            monto_total: montoTotal.toFixed(2),
          })
          .returning();
      } catch (e: any) {
        if (e?.code === "23505") {
          throw new ConflictException(
            `La venta ${serieVale}-${numeroVale} ya existe para esta gasolinera`,
          );
        }
        throw e;
      }

      await tx.insert(ventaInsumoDetalles).values(
        renglones.map((r) => ({
          venta_id: venta.id,
          producto_id: r.producto.id,
          cantidad: r.cantidad,
          precio_unitario: r.precioUnitario.toFixed(2),
          subtotal: r.subtotal.toFixed(2),
        })),
      );

      for (const r of renglones) {
        await tx
          .update(productos)
          .set({ stock_actual: r.producto.stock_actual - r.cantidad })
          .where(eq(productos.id, r.producto.id));

        await tx.insert(inventarioMovimientos).values({
          producto_id: r.producto.id,
          tipo: "salida",
          cantidad: r.cantidad,
          motivo: "Venta de insumos",
          referencia: `${serieVale}-${numeroVale}`,
        });
      }

      // En efectivo el dinero entra a caja y la cuenta del cliente no se toca.
      // A cargo, la venta baja al mismo ledger que los despachos, así que sale
      // en el estado de cuenta junto al combustible.
      if (dto.forma_pago === FormaPago.CARGO_CLIENTE && dto.cliente_id) {
        await tx.insert(movimientosSaldo).values({
          cliente_id: dto.cliente_id,
          gasolinera_id: user.gasolinera_id,
          tipo: "debito",
          monto: montoTotal.toFixed(3),
          descripcion: `Insumos ${renglones.length} producto(s) - Vale ${serieVale}-${numeroVale}`,
        });

        await tx
          .update(saldosCliente)
          .set({
            saldo_actual: sql`saldo_actual - ${montoTotal.toFixed(3)}::numeric`,
            updated_at: new Date(),
          })
          .where(eq(saldosCliente.cliente_id, dto.cliente_id));
      }

      return {
        ...venta,
        detalles: renglones.map((r) => ({
          producto_id: r.producto.id,
          nombre: r.producto.nombre,
          cantidad: r.cantidad,
          precio_unitario: r.precioUnitario.toFixed(2),
          subtotal: r.subtotal.toFixed(2),
        })),
      };
    });
  }
}
