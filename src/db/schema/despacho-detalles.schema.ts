import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  numeric,
  index,
} from "drizzle-orm/pg-core";
import { despachos } from "./despachos.schema";
import { preciosCombustible } from "./precios-combustible.schema";

/**
 * Un vale puede tener varios renglones: al vehículo, a canecas y a toneles, en
 * cualquier combinación (incluso sin vehículo). Cada renglón lleva su propio
 * combustible, precio y monto; el vale unifica el total.
 */
export const RENGLONES = ["vehiculo", "caneca", "tonel"] as const;
export type Renglon = (typeof RENGLONES)[number];
export const renglonEnum = pgEnum("renglon_despacho", RENGLONES);

export const despachoDetalles = pgTable(
  "despacho_detalles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    despacho_id: uuid("despacho_id")
      .notNull()
      .references(() => despachos.id),
    renglon: renglonEnum("renglon").notNull(),
    // Se guarda el tipo además del precio_id para no tener que unir con precios
    // en cada lectura del vale, que es el camino caliente en la bomba.
    tipo_combustible: varchar("tipo_combustible").notNull(),
    precio_id: uuid("precio_id")
      .notNull()
      .references(() => preciosCombustible.id),
    monto: numeric("monto", { precision: 10, scale: 3 }).notNull(),
    galones: numeric("galones", { precision: 10, scale: 3 }).notNull(),
  },
  (t) => [
    index("despacho_detalles_despacho_idx").on(t.despacho_id),
    // Los límites por vehículo agregan sobre esta tabla filtrando por renglón:
    // sumar el monto_total del header sobrecontaría en vales mixtos.
    index("despacho_detalles_renglon_idx").on(t.renglon),
  ],
);
