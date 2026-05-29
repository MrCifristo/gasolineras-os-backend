import { pgTable, uuid, varchar, boolean } from "drizzle-orm/pg-core";
import { gasolineras } from "./gasolineras.schema";
import { clientes } from "./clientes.schema";

export const usuarios = pgTable("usuarios", {
  id: uuid("id").primaryKey().defaultRandom(),
  supabase_user_id: uuid("supabase_user_id").unique().notNull(),
  gasolinera_id: uuid("gasolinera_id").references(() => gasolineras.id),
  cliente_id: uuid("cliente_id").references(() => clientes.id),
  email: varchar("email").unique().notNull(),
  nombre: varchar("nombre").notNull(),
  rol: varchar("rol").notNull(),
  activo: boolean("activo").default(true),
});
