import {
  pgTable,
  uuid,
  varchar,
  numeric,
  integer,
  boolean,
} from "drizzle-orm/pg-core";

/**
 * Insumos que la estación vende aparte del combustible: aceites, refrigerante,
 * filtros. Catálogo compartido por las gasolineras; el stock es el de la
 * estación, no por cliente.
 */
export const productos = pgTable("productos", {
  id: uuid("id").primaryKey().defaultRandom(),
  nombre: varchar("nombre").notNull(),
  sku: varchar("sku").unique(),
  precio: numeric("precio", { precision: 10, scale: 2 }).notNull(),
  // Entero: los insumos se venden por unidad, no fraccionados.
  stock_actual: integer("stock_actual").notNull().default(0),
  // Umbral de reposición; `stock_actual <= stock_minimo` es "stock bajo".
  stock_minimo: integer("stock_minimo").notNull().default(0),
  activo: boolean("activo").notNull().default(true),
});
