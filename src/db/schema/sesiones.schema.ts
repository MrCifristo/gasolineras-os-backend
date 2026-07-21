import { pgTable, uuid, varchar, timestamp, index } from "drizzle-orm/pg-core";
import { usuarios } from "./usuarios.schema";

/**
 * Un refresh token vivo. El token nunca se guarda: sólo su SHA-256.
 *
 * `familia_id` se mantiene constante a través de todas las rotaciones de una
 * misma sesión. Si un refresh ya consumido vuelve a aparecer (`usado_at` no es
 * null), es replay: se revoca la familia entera, no sólo esa fila.
 */
export const sesiones = pgTable(
  "sesiones",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    usuario_id: uuid("usuario_id")
      .notNull()
      .references(() => usuarios.id, { onDelete: "cascade" }),
    // SHA-256 en hex. No argon2: el token ya es aleatorio de 256 bits, así que
    // un hash lento no agrega nada y se pagaría en cada refresh.
    refresh_token_hash: varchar("refresh_token_hash", { length: 64 })
      .notNull()
      .unique(),
    familia_id: uuid("familia_id").notNull(),
    // Se sella al consumir el token. Un segundo consumo es la señal de replay.
    usado_at: timestamp("usado_at", { withTimezone: true }),
    revocado_at: timestamp("revocado_at", { withTimezone: true }),
    expira_at: timestamp("expira_at", { withTimezone: true }).notNull(),
    // Tope duro de la familia: la rotación desliza expira_at, pero nunca más
    // allá de esto. Sin él, una familia robada vive para siempre.
    familia_expira_at: timestamp("familia_expira_at", {
      withTimezone: true,
    }).notNull(),
    creado_at: timestamp("creado_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    ultimo_uso_at: timestamp("ultimo_uso_at", { withTimezone: true }),
    user_agent: varchar("user_agent", { length: 255 }),
    ip: varchar("ip", { length: 45 }),
  },
  (t) => [
    index("sesiones_usuario_idx").on(t.usuario_id),
    index("sesiones_familia_idx").on(t.familia_id),
    index("sesiones_expira_idx").on(t.expira_at),
  ],
);
