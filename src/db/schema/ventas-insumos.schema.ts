import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  integer,
  numeric,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { gasolineras } from "./gasolineras.schema";
import { clientes } from "./clientes.schema";
import { usuarios } from "./usuarios.schema";
import { operarios } from "./operarios.schema";
import { productos } from "./productos.schema";

export const FORMAS_PAGO = ["efectivo", "cargo_cliente"] as const;
export const formaPagoEnum = pgEnum("forma_pago_insumo", FORMAS_PAGO);

/**
 * Venta de insumos. Lleva su propia serie de vale, independiente de la de
 * combustible: son documentos distintos y numerarlos juntos haría ilegible
 * cualquier conciliación.
 */
export const ventasInsumos = pgTable(
  "ventas_insumos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    gasolinera_id: uuid("gasolinera_id")
      .notNull()
      .references(() => gasolineras.id),
    // Quién registró la venta (supervisor/admin), tomado del token.
    usuario_id: uuid("usuario_id")
      .notNull()
      .references(() => usuarios.id),
    // Quién entregó físicamente el producto.
    operario_id: uuid("operario_id").references(() => operarios.id),
    // Sólo en cargo_cliente: en efectivo no hay cuenta a la que imputar.
    cliente_id: uuid("cliente_id").references(() => clientes.id),
    forma_pago: formaPagoEnum("forma_pago").notNull(),
    numero_vale: varchar("numero_vale").notNull(),
    serie_vale: varchar("serie_vale").notNull(),
    bomba_numero: integer("bomba_numero"),
    monto_total: numeric("monto_total", { precision: 12, scale: 2 }).notNull(),
    vendido_at: timestamp("vendido_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("ventas_insumos_gasolinera_serie_vale_idx").on(
      t.gasolinera_id,
      t.serie_vale,
      t.numero_vale,
    ),
  ],
);

/**
 * Renglones de la venta. `precio_unitario` se congela acá: si mañana cambia el
 * precio del producto, la venta pasada debe seguir valiendo lo que valió.
 */
export const ventaInsumoDetalles = pgTable(
  "venta_insumo_detalles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    venta_id: uuid("venta_id")
      .notNull()
      .references(() => ventasInsumos.id),
    producto_id: uuid("producto_id")
      .notNull()
      .references(() => productos.id),
    cantidad: integer("cantidad").notNull(),
    precio_unitario: numeric("precio_unitario", {
      precision: 10,
      scale: 2,
    }).notNull(),
    subtotal: numeric("subtotal", { precision: 12, scale: 2 }).notNull(),
  },
  (t) => [index("venta_insumo_detalles_venta_idx").on(t.venta_id)],
);
