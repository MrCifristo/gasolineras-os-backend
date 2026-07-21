import {
  pgTable,
  uuid,
  varchar,
  boolean,
  decimal,
  text,
  integer,
} from "drizzle-orm/pg-core";
import { clientes } from "./clientes.schema";

export const vehiculos = pgTable("vehiculos", {
  id: uuid("id").primaryKey().defaultRandom(),
  cliente_id: uuid("cliente_id")
    .notNull()
    .references(() => clientes.id),
  placa: varchar("placa").unique().notNull(),
  marca: varchar("marca"),
  modelo: varchar("modelo"),
  ruta: varchar("ruta"),
  tipo_vehiculo: varchar("tipo_vehiculo"),
  activo: boolean("activo").default(true),
  bloqueado: boolean("bloqueado").notNull().default(false),
  limite_monto_transaccion: decimal("limite_monto_transaccion", {
    precision: 10,
    scale: 2,
  }),
  limite_monto_dia: decimal("limite_monto_dia", { precision: 10, scale: 2 }),
  limite_monto_semana: decimal("limite_monto_semana", {
    precision: 10,
    scale: 2,
  }),
  limite_monto_mes: decimal("limite_monto_mes", { precision: 10, scale: 2 }),
  limite_volumen_transaccion: decimal("limite_volumen_transaccion", {
    precision: 10,
    scale: 3,
  }),
  limite_volumen_dia: decimal("limite_volumen_dia", {
    precision: 10,
    scale: 3,
  }),
  limite_volumen_semana: decimal("limite_volumen_semana", {
    precision: 10,
    scale: 3,
  }),
  limite_volumen_mes: decimal("limite_volumen_mes", {
    precision: 10,
    scale: 3,
  }),
  limite_trans_dia: integer("limite_trans_dia"),
  limite_trans_semana: integer("limite_trans_semana"),
  limite_trans_mes: integer("limite_trans_mes"),
  productos_permitidos: text("productos_permitidos").array(),
  dias_permitidos: text("dias_permitidos").array(),
  hora_inicio: varchar("hora_inicio", { length: 5 }),
  hora_fin: varchar("hora_fin", { length: 5 }),
});
