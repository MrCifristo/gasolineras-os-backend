import {
  pgTable,
  uuid,
  varchar,
  time,
  boolean,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { gasolineras } from "./gasolineras.schema";

/**
 * Horario de los dos turnos de cada gasolinera. Siempre exactamente una fila
 * por (gasolinera, turno): la crea la migración para las existentes y
 * GasolinerasService.create para las nuevas. `hora_fin < hora_inicio` es
 * válido y significa que el turno cruza la medianoche.
 */
export const turnosGasolinera = pgTable(
  "turnos_gasolinera",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    gasolinera_id: uuid("gasolinera_id")
      .notNull()
      .references(() => gasolineras.id),
    // 'manana' | 'tarde', el mismo vocabulario que despachos.turno.
    turno: varchar("turno").notNull(),
    hora_inicio: time("hora_inicio").notNull(),
    hora_fin: time("hora_fin").notNull(),
    recordatorio_activo: boolean("recordatorio_activo").notNull().default(true),
    updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    uniqueIndex("turnos_gasolinera_gasolinera_turno_idx").on(
      t.gasolinera_id,
      t.turno,
    ),
  ],
);
