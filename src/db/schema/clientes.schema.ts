import {
  pgTable,
  uuid,
  varchar,
  boolean,
  decimal,
  integer,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const clientes = pgTable(
  "clientes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    nombre: varchar("nombre").notNull(),
    nit: varchar("nit"),
    contacto_email: varchar("contacto_email"),
    activo: boolean("activo").default(true),
    bloqueado: boolean("bloqueado").notNull().default(false),
    // Distinto de `bloqueado`: aquél es una suspensión operativa completa (la
    // pide el propio cliente); éste corta sólo el consumo a crédito, por mora o
    // por decisión administrativa. Un cliente con crédito suspendido sigue
    // existiendo, consultando su estado de cuenta y recibiendo abonos.
    credito_bloqueado: boolean("credito_bloqueado").notNull().default(false),
    limite_monto_dia: decimal("limite_monto_dia", { precision: 10, scale: 2 }),
    limite_monto_semana: decimal("limite_monto_semana", {
      precision: 10,
      scale: 2,
    }),
    limite_monto_mes: decimal("limite_monto_mes", { precision: 10, scale: 2 }),
    // Sin limite_monto_transaccion: el control por transacción opera a nivel vehículo, no de cuenta
    plantilla_monto_transaccion: decimal("plantilla_monto_transaccion", {
      precision: 10,
      scale: 2,
    }),
    plantilla_monto_dia: decimal("plantilla_monto_dia", {
      precision: 10,
      scale: 2,
    }),
    plantilla_monto_semana: decimal("plantilla_monto_semana", {
      precision: 10,
      scale: 2,
    }),
    plantilla_monto_mes: decimal("plantilla_monto_mes", {
      precision: 10,
      scale: 2,
    }),
    plantilla_volumen_transaccion: decimal("plantilla_volumen_transaccion", {
      precision: 10,
      scale: 3,
    }),
    plantilla_volumen_dia: decimal("plantilla_volumen_dia", {
      precision: 10,
      scale: 3,
    }),
    plantilla_volumen_semana: decimal("plantilla_volumen_semana", {
      precision: 10,
      scale: 3,
    }),
    plantilla_volumen_mes: decimal("plantilla_volumen_mes", {
      precision: 10,
      scale: 3,
    }),
    plantilla_trans_dia: integer("plantilla_trans_dia"),
    plantilla_trans_semana: integer("plantilla_trans_semana"),
    plantilla_trans_mes: integer("plantilla_trans_mes"),
    plantilla_productos_permitidos: text(
      "plantilla_productos_permitidos",
    ).array(),
  },
  (t) => [
    // Un NIT por empresa, sin distinguir mayúsculas ni guiones, contando los
    // clientes desactivados (para volver se reactiva, no se registra de nuevo).
    // "CF" (consumidor final) puede repetirse. La misma clave calcula
    // `claveNit` en clientes.reglas.ts.
    uniqueIndex("clientes_nit_unico")
      .on(sql`upper(replace(${t.nit}, '-', ''))`)
      .where(
        sql`${t.nit} IS NOT NULL AND upper(replace(${t.nit}, '-', '')) NOT IN ('', 'CF')`,
      ),
  ],
);
