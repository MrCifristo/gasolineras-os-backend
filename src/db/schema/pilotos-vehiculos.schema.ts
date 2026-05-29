import { pgTable, uuid, primaryKey } from "drizzle-orm/pg-core";
import { pilotos } from "./pilotos.schema";
import { vehiculos } from "./vehiculos.schema";

export const pilotosVehiculos = pgTable(
  "pilotos_vehiculos",
  {
    piloto_id: uuid("piloto_id")
      .notNull()
      .references(() => pilotos.id),
    vehiculo_id: uuid("vehiculo_id")
      .notNull()
      .references(() => vehiculos.id),
  },
  (t) => [primaryKey({ columns: [t.piloto_id, t.vehiculo_id] })],
);
