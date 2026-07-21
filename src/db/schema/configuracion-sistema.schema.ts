import {
  pgTable,
  uuid,
  boolean,
  varchar,
  timestamp,
} from "drizzle-orm/pg-core";

export const configuracionSistema = pgTable("configuracion_sistema", {
  id: uuid("id").primaryKey().defaultRandom(),
  sistema_bloqueado: boolean("sistema_bloqueado").notNull().default(false),
  bloqueado_por: varchar("bloqueado_por", { length: 255 }), // email del admin que activó el bloqueo
  bloqueado_en: timestamp("bloqueado_en"),
  updated_at: timestamp("updated_at").notNull().defaultNow(),
});
