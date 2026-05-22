import { pgTable, uuid, varchar, text, date, timestamp } from 'drizzle-orm/pg-core';
import { clientes } from './clientes.schema';
import { gasolineras } from './gasolineras.schema';
import { usuarios } from './usuarios.schema';

export const cuadres = pgTable('cuadres', {
  id: uuid('id').primaryKey().defaultRandom(),
  tipo: varchar('tipo').notNull(),
  gasolinera_id: uuid('gasolinera_id')
    .notNull()
    .references(() => gasolineras.id),
  cliente_id: uuid('cliente_id').references(() => clientes.id),
  fecha_desde: date('fecha_desde').notNull(),
  fecha_hasta: date('fecha_hasta').notNull(),
  cuadrado_por: uuid('cuadrado_por')
    .notNull()
    .references(() => usuarios.id),
  notas: text('notas'),
  created_at: timestamp('created_at').defaultNow(),
});
