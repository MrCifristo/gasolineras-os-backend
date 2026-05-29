import {
  pgTable,
  uuid,
  varchar,
  integer,
  numeric,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { gasolineras } from "./gasolineras.schema";
import { clientes } from "./clientes.schema";
import { vehiculos } from "./vehiculos.schema";
import { pilotos } from "./pilotos.schema";
import { usuarios } from "./usuarios.schema";
import { preciosCombustible } from "./precios-combustible.schema";

export const despachos = pgTable(
  "despachos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    gasolinera_id: uuid("gasolinera_id")
      .notNull()
      .references(() => gasolineras.id),
    cliente_id: uuid("cliente_id")
      .notNull()
      .references(() => clientes.id),
    vehiculo_id: uuid("vehiculo_id")
      .notNull()
      .references(() => vehiculos.id),
    piloto_id: uuid("piloto_id")
      .notNull()
      .references(() => pilotos.id),
    despachador_id: uuid("despachador_id")
      .notNull()
      .references(() => usuarios.id),
    precio_id: uuid("precio_id")
      .notNull()
      .references(() => preciosCombustible.id),
    numero_vale: varchar("numero_vale").notNull(),
    serie_vale: varchar("serie_vale").notNull(),
    turno: varchar("turno").notNull(),
    bomba_numero: integer("bomba_numero"),
    kilometraje: numeric("kilometraje", { precision: 10, scale: 3 }),
    galones: numeric("galones", { precision: 10, scale: 3 }).notNull(),
    monto_total: numeric("monto_total", { precision: 10, scale: 3 }).notNull(),
    firma_piloto_base64: text("firma_piloto_base64"),
    despachado_at: timestamp("despachado_at").defaultNow(),
  },
  (t) => [
    uniqueIndex("despachos_gasolinera_serie_vale_idx").on(
      t.gasolinera_id,
      t.serie_vale,
      t.numero_vale,
    ),
  ],
);
