import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  integer,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { productos } from "./productos.schema";

export const TIPOS_MOVIMIENTO_INVENTARIO = ["entrada", "salida"] as const;
export const tipoMovimientoInventarioEnum = pgEnum(
  "tipo_movimiento_inventario",
  TIPOS_MOVIMIENTO_INVENTARIO,
);

/**
 * Kardex del inventario: toda variación de `productos.stock_actual` deja una
 * fila acá. Sin esto, un faltante no se puede explicar — sólo se ve el número
 * final, no de dónde salió.
 */
export const inventarioMovimientos = pgTable(
  "inventario_movimientos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    producto_id: uuid("producto_id")
      .notNull()
      .references(() => productos.id),
    tipo: tipoMovimientoInventarioEnum("tipo").notNull(),
    // Siempre positiva; la dirección la marca `tipo`, igual que en el ledger
    // de saldos.
    cantidad: integer("cantidad").notNull(),
    motivo: varchar("motivo"),
    // Id de la venta que lo originó, o el documento de la compra al proveedor.
    referencia: varchar("referencia"),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("inventario_movimientos_producto_idx").on(t.producto_id)],
);
