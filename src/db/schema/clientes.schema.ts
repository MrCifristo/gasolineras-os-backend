import { pgTable, uuid, varchar, boolean } from "drizzle-orm/pg-core";

export const clientes = pgTable("clientes", {
  id: uuid("id").primaryKey().defaultRandom(),
  nombre: varchar("nombre").notNull(),
  nit: varchar("nit"),
  contacto_email: varchar("contacto_email"),
  activo: boolean("activo").default(true),
});
