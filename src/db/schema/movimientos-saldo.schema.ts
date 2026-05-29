import {
  pgTable,
  uuid,
  varchar,
  numeric,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { clientes } from "./clientes.schema";
import { gasolineras } from "./gasolineras.schema";
import { despachos } from "./despachos.schema";

export const movimientosSaldo = pgTable("movimientos_saldo", {
  id: uuid("id").primaryKey().defaultRandom(),
  cliente_id: uuid("cliente_id")
    .notNull()
    .references(() => clientes.id),
  gasolinera_id: uuid("gasolinera_id")
    .notNull()
    .references(() => gasolineras.id),
  despacho_id: uuid("despacho_id").references(() => despachos.id),
  tipo: varchar("tipo").notNull(),
  monto: numeric("monto", { precision: 14, scale: 3 }).notNull(),
  descripcion: text("descripcion"),
  created_at: timestamp("created_at").defaultNow(),
});
