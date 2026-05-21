import { pgTable, uuid, varchar, boolean } from 'drizzle-orm/pg-core';
import { clientes } from './clientes.schema';

export const vehiculos = pgTable('vehiculos', {
  id: uuid('id').primaryKey().defaultRandom(),
  cliente_id: uuid('cliente_id')
    .notNull()
    .references(() => clientes.id),
  placa: varchar('placa').unique().notNull(),
  marca: varchar('marca'),
  modelo: varchar('modelo'),
  ruta: varchar('ruta'),
  tipo_vehiculo: varchar('tipo_vehiculo'),
  activo: boolean('activo').default(true),
});
