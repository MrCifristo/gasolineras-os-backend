import {
  pgTable,
  uuid,
  varchar,
  date,
  integer,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { gasolineras } from "./gasolineras.schema";

/**
 * Un aviso enviado por (gasolinera, turno, fecha). El índice único es el
 * candado de idempotencia: quien logra insertar, envía; los demás ticks o
 * instancias ven el conflicto y se saltan el turno.
 */
export const recordatoriosTurno = pgTable(
  "recordatorios_turno",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    gasolinera_id: uuid("gasolinera_id")
      .notNull()
      .references(() => gasolineras.id),
    turno: varchar("turno").notNull(),
    // Fecha de Guatemala del día en que arranca el turno.
    fecha: date("fecha").notNull(),
    enviado_en: timestamp("enviado_en", { withTimezone: true }).defaultNow(),
    correos_enviados: integer("correos_enviados").notNull().default(0),
    push_enviados: integer("push_enviados").notNull().default(0),
  },
  (t) => [
    uniqueIndex("recordatorios_turno_unico_idx").on(
      t.gasolinera_id,
      t.turno,
      t.fecha,
    ),
  ],
);
