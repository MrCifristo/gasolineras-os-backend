import {
  pgTable,
  uuid,
  varchar,
  integer,
  numeric,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { gasolineras } from "./gasolineras.schema";
import { clientes } from "./clientes.schema";
import { vehiculos } from "./vehiculos.schema";
import { pilotos } from "./pilotos.schema";
import { usuarios } from "./usuarios.schema";
import { operarios } from "./operarios.schema";
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
    // Nullables desde el vale multi-renglón: un despacho puede ser sólo a
    // canecas o toneles, sin vehículo ni piloto involucrados.
    vehiculo_id: uuid("vehiculo_id").references(() => vehiculos.id),
    piloto_id: uuid("piloto_id").references(() => pilotos.id),
    // Quién inició sesión y registró el vale (supervisor/admin).
    despachador_id: uuid("despachador_id")
      .notNull()
      .references(() => usuarios.id),
    // Quién físicamente despachó, elegido de un listado. Nullable para migrar
    // vales anteriores a la separación supervisor/operario.
    operario_id: uuid("operario_id").references(() => operarios.id),
    // Precio del renglón principal. Se conserva —y nullable— para que los
    // lectores viejos (filtro por tipo, Excel) sigan funcionando; el detalle
    // real por renglón vive en `despacho_detalles`.
    precio_id: uuid("precio_id").references(() => preciosCombustible.id),
    numero_vale: varchar("numero_vale").notNull(),
    serie_vale: varchar("serie_vale").notNull(),
    turno: varchar("turno").notNull(),
    bomba_numero: integer("bomba_numero"),
    kilometraje: numeric("kilometraje", { precision: 10, scale: 3 }),
    // Denormalizados a propósito: son la SUMA de los renglones. Reportes,
    // Excel, límites de cuenta y el débito de saldo siguen leyendo de acá.
    galones: numeric("galones", { precision: 10, scale: 3 }).notNull(),
    monto_total: numeric("monto_total", { precision: 10, scale: 3 }).notNull(),
    // Key del objeto en R2, no el blob. Los base64 de firma inflaban esta
    // tabla de hechos y pesaban en cada SELECT.
    firma_key: varchar("firma_key", { length: 255 }),
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
