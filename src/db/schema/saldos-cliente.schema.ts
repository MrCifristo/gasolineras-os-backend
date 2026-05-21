import { pgTable, uuid, numeric, timestamp } from 'drizzle-orm/pg-core';
import { clientes } from './clientes.schema';

export const saldosCliente = pgTable('saldos_cliente', {
  id: uuid('id').primaryKey().defaultRandom(),
  cliente_id: uuid('cliente_id')
    .notNull()
    .unique()
    .references(() => clientes.id),
  saldo_actual: numeric('saldo_actual', { precision: 14, scale: 3 }).notNull().default('0'),
  updated_at: timestamp('updated_at').defaultNow(),
});
