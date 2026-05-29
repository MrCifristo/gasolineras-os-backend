import { pgTable, uuid, varchar, boolean } from "drizzle-orm/pg-core";
import { clientes } from "./clientes.schema";

export const pilotos = pgTable("pilotos", {
  id: uuid("id").primaryKey().defaultRandom(),
  cliente_id: uuid("cliente_id")
    .notNull()
    .references(() => clientes.id),
  nombre_completo: varchar("nombre_completo").notNull(),
  codigo: varchar("codigo"),
  activo: boolean("activo").default(true),
});
