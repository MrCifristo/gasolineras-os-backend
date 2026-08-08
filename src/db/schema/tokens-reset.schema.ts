import { pgTable, uuid, varchar, timestamp, index } from "drizzle-orm/pg-core";
import { usuarios } from "./usuarios.schema";

/**
 * Tokens de recuperación de contraseña.
 *
 * En la base sólo vive el SHA-256 del token, nunca el token en claro: si se
 * filtrara la tabla, las filas no sirven para tomar ninguna cuenta. SHA-256 y
 * no argon2 porque el token ya son 256 bits aleatorios — no hay entropía baja
 * que un hash lento deba proteger.
 */
export const tokensReset = pgTable(
  "tokens_reset",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    usuario_id: uuid("usuario_id")
      .notNull()
      .references(() => usuarios.id),
    // 64 caracteres hex = SHA-256.
    token_hash: varchar("token_hash", { length: 64 }).notNull().unique(),
    expira_at: timestamp("expira_at", { withTimezone: true }).notNull(),
    // Un token se consume una sola vez; reusarlo es un 400.
    usado_at: timestamp("usado_at", { withTimezone: true }),
    creado_at: timestamp("creado_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("tokens_reset_usuario_idx").on(t.usuario_id)],
);
