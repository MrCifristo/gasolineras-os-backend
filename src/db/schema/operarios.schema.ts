import { pgTable, uuid, varchar, boolean } from "drizzle-orm/pg-core";
import { gasolineras } from "./gasolineras.schema";

// El operario que físicamente despacha en la bomba. No es una cuenta: no tiene
// login ni contraseña. El supervisor (que sí inicia sesión) lo elige de un
// listado al registrar el despacho. Ligado a una gasolinera, no a un cliente.
export const operarios = pgTable("operarios", {
  id: uuid("id").primaryKey().defaultRandom(),
  gasolinera_id: uuid("gasolinera_id")
    .notNull()
    .references(() => gasolineras.id),
  nombre: varchar("nombre").notNull(),
  codigo: varchar("codigo"),
  activo: boolean("activo").notNull().default(true),
});
