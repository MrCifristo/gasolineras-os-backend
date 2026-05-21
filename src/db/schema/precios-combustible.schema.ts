import { pgTable, uuid, varchar, date, numeric, uniqueIndex } from 'drizzle-orm/pg-core';
import { gasolineras } from './gasolineras.schema';

export const preciosCombustible = pgTable(
  'precios_combustible',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    gasolinera_id: uuid('gasolinera_id')
      .notNull()
      .references(() => gasolineras.id),
    fecha: date('fecha').notNull(),
    tipo_combustible: varchar('tipo_combustible').notNull(),
    precio_galon: numeric('precio_galon', { precision: 10, scale: 3 }).notNull(),
  },
  (t) => [
    uniqueIndex('precios_combustible_gasolinera_fecha_tipo_idx').on(
      t.gasolinera_id,
      t.fecha,
      t.tipo_combustible,
    ),
  ],
);
