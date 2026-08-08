import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  boolean,
  timestamp,
} from "drizzle-orm/pg-core";
import { gasolineras } from "./gasolineras.schema";
import { clientes } from "./clientes.schema";

export const ROLES = ["admin", "supervisor", "cliente", "jefe_pista"] as const;
export const rolEnum = pgEnum("rol", ROLES);

export const usuarios = pgTable("usuarios", {
  id: uuid("id").primaryKey().defaultRandom(),
  gasolinera_id: uuid("gasolinera_id").references(() => gasolineras.id),
  cliente_id: uuid("cliente_id").references(() => clientes.id),
  // email o telefono: al menos uno debe existir (CHECK en la migración). unique
  // permite múltiples NULL, así que un cliente sin correo no choca con otro.
  email: varchar("email").unique(),
  telefono: varchar("telefono").unique(),
  nombre: varchar("nombre").notNull(),
  // argon2id ronda los 95-100 caracteres.
  password_hash: varchar("password_hash", { length: 255 }).notNull(),
  // Cambiar la contraseña invalida toda sesión emitida antes de esta marca.
  password_actualizado_at: timestamp("password_actualizado_at", {
    withTimezone: true,
  })
    .notNull()
    .defaultNow(),
  rol: rolEnum("rol").notNull(),
  // notNull a propósito: cuando era nullable-con-default, `!usuario.activo`
  // trataba NULL como inactivo y bloqueaba al usuario en silencio.
  activo: boolean("activo").notNull().default(true),
});
