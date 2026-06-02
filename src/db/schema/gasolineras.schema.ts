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
  activo: boolean("activo").default(true),
  bloqueado: boolean("bloqueado").notNull().default(false),
  created_at: timestamp("created_at").defaultNow(),
});
