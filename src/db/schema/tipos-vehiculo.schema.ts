import {
  pgTable,
  uuid,
  varchar,
  boolean,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// Catálogo de tipos de vehículo que administra el admin. Sólo alimenta la
// lista del formulario: `vehiculos.tipo_vehiculo` sigue siendo texto (sin FK),
// así que desactivar un tipo no toca a los vehículos que ya lo tienen.
// Renombrarlo sí los actualiza (tipos-vehiculo.service.ts).
export const tiposVehiculo = pgTable(
  "tipos_vehiculo",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    nombre: varchar("nombre").notNull(),
    activo: boolean("activo").notNull().default(true),
  },
  (t) => [
    // Un nombre por tipo activo, sin distinguir mayúsculas; uno desactivado
    // puede volver a crearse.
    uniqueIndex("tipos_vehiculo_nombre_unico")
      .on(sql`lower(${t.nombre})`)
      .where(sql`${t.activo}`),
  ],
);
