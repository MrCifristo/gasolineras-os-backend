import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, desc, eq, lte, sql } from "drizzle-orm";
import { DbService } from "../../db/db.service";
import { inventarioMovimientos, productos } from "../../db/schema";
import { CreateProductoDto } from "./dto/create-producto.dto";
import { AjustarStockDto } from "./dto/ajustar-stock.dto";
import { UpdateProductoDto } from "./dto/update-producto.dto";

@Injectable()
export class InventarioService {
  constructor(private readonly db: DbService) {}

  findAll(soloBajos = false) {
    const condiciones = [eq(productos.activo, true)];
    if (soloBajos) {
      condiciones.push(lte(productos.stock_actual, productos.stock_minimo));
    }
    return this.db.db
      .select()
      .from(productos)
      .where(and(...condiciones))
      .orderBy(productos.nombre);
  }

  async findOne(id: string) {
    const [producto] = await this.db.db
      .select()
      .from(productos)
      .where(eq(productos.id, id))
      .limit(1);
    if (!producto) throw new NotFoundException("Producto no encontrado");
    return producto;
  }

  async create(dto: CreateProductoDto) {
    const { stock_actual = 0, ...datos } = dto;

    return this.db.db.transaction(async (tx) => {
      const [producto] = await tx
        .insert(productos)
        .values({
          ...datos,
          precio: String(datos.precio),
          stock_actual,
        })
        .returning();

      // La existencia inicial también entra al kardex: si no, el primer número
      // aparecería de la nada y no cuadraría contra los movimientos.
      if (stock_actual > 0) {
        await tx.insert(inventarioMovimientos).values({
          producto_id: producto.id,
          tipo: "entrada",
          cantidad: stock_actual,
          motivo: "Existencia inicial",
        });
      }

      return producto;
    });
  }

  async update(id: string, dto: UpdateProductoDto) {
    await this.findOne(id);
    const cambios: Record<string, unknown> = { ...dto };
    if (dto.precio != null) cambios.precio = String(dto.precio);

    const [row] = await this.db.db
      .update(productos)
      .set(cambios)
      .where(eq(productos.id, id))
      .returning();
    return row;
  }

  /** Baja lógica: la fila queda por integridad con las ventas anteriores. */
  async remove(id: string) {
    await this.findOne(id);
    const [row] = await this.db.db
      .update(productos)
      .set({ activo: false })
      .where(eq(productos.id, id))
      .returning();
    return row;
  }

  /**
   * Entrada o salida manual de stock. Todo en una transacción con la fila
   * bloqueada: dos ajustes concurrentes sobre el mismo producto se serializan
   * en vez de pisarse.
   */
  async ajustarStock(id: string, dto: AjustarStockDto) {
    return this.db.db.transaction(async (tx) => {
      const [producto] = await tx
        .select()
        .from(productos)
        .where(eq(productos.id, id))
        .for("update")
        .limit(1);
      if (!producto) throw new NotFoundException("Producto no encontrado");

      const delta = dto.tipo === "entrada" ? dto.cantidad : -dto.cantidad;
      const resultante = producto.stock_actual + delta;

      // El stock no puede quedar negativo: a diferencia del saldo del cliente,
      // acá no hay nada que "deber" — o el producto está en la bodega o no.
      if (resultante < 0) {
        throw new BadRequestException(
          `Stock insuficiente: hay ${producto.stock_actual} y se intentan sacar ${dto.cantidad}`,
        );
      }

      await tx.insert(inventarioMovimientos).values({
        producto_id: id,
        tipo: dto.tipo,
        cantidad: dto.cantidad,
        motivo: dto.motivo ?? null,
        referencia: dto.referencia ?? null,
      });

      const [row] = await tx
        .update(productos)
        .set({ stock_actual: resultante })
        .where(eq(productos.id, id))
        .returning();

      return row;
    });
  }

  async movimientos(id: string) {
    await this.findOne(id);
    return this.db.db
      .select()
      .from(inventarioMovimientos)
      .where(eq(inventarioMovimientos.producto_id, id))
      .orderBy(desc(inventarioMovimientos.created_at))
      .limit(100);
  }

  /** Productos en o por debajo de su umbral de reposición. */
  bajos() {
    return this.db.db
      .select()
      .from(productos)
      .where(
        and(
          eq(productos.activo, true),
          sql`${productos.stock_actual} <= ${productos.stock_minimo}`,
        ),
      )
      .orderBy(productos.stock_actual);
  }
}
