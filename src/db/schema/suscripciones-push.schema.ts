import { pgTable, uuid, text, varchar, timestamp } from "drizzle-orm/pg-core";
import { usuarios } from "./usuarios.schema";

/**
 * Una suscripción de Web Push por navegador. `endpoint` es único: si otro
 * usuario inicia sesión en el mismo navegador y se suscribe, la fila se
 * reasigna en vez de duplicarse (el navegador sólo tiene un endpoint).
 */
export const suscripcionesPush = pgTable("suscripciones_push", {
  id: uuid("id").primaryKey().defaultRandom(),
  usuario_id: uuid("usuario_id")
    .notNull()
    .references(() => usuarios.id, { onDelete: "cascade" }),
  endpoint: text("endpoint").notNull().unique(),
  p256dh: varchar("p256dh").notNull(),
  auth: varchar("auth").notNull(),
  user_agent: varchar("user_agent"),
  created_at: timestamp("created_at", { withTimezone: true }).defaultNow(),
});
