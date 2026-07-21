import {
  pgTable,
  uuid,
  varchar,
  boolean,
  timestamp,
} from "drizzle-orm/pg-core";

export const gasolineras = pgTable("gasolineras", {
  id: uuid("id").primaryKey().defaultRandom(),
  nombre: varchar("nombre").notNull(),
  direccion: varchar("direccion").notNull(),
  ciudad: varchar("ciudad").notNull(),
  // Serie del talonario de vales en uso. El admin la cambia al abrir uno nuevo.
  // El backend la lee de acá: el cliente no la manda ni puede influirla, y la
  // numeración ya se serializa por (gasolinera, serie) con un advisory lock.
  serie_vale_actual: varchar("serie_vale_actual").notNull().default("A"),
  activo: boolean("activo").default(true),
  bloqueado: boolean("bloqueado").notNull().default(false),
  created_at: timestamp("created_at").defaultNow(),
});
