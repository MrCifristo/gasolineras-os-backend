import { pgTable, uuid, varchar, boolean, timestamp } from 'drizzle-orm/pg-core';

export const gasolineras = pgTable('gasolineras', {
  id: uuid('id').primaryKey().defaultRandom(),
  nombre: varchar('nombre').notNull(),
  direccion: varchar('direccion').notNull(),
  ciudad: varchar('ciudad').notNull(),
  activo: boolean('activo').default(true),
  created_at: timestamp('created_at').defaultNow(),
});
