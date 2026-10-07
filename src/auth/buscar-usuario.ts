// src/auth/buscar-usuario.ts
// Consulta compartida por login y recuperación de contraseña: el identificador
// es correo o teléfono. Vive en un solo lugar para que ambos flujos no
// diverjan en cómo encuentran a un usuario.
import { eq, or } from "drizzle-orm";
import type { DbService } from "../db/db.service";
import { usuarios } from "../db/schema";

type Usuario = typeof usuarios.$inferSelect;

export async function buscarUsuarioPorIdentificador(
  db: DbService,
  identificador: string,
): Promise<Usuario | undefined> {
  const [usuario] = await db.db
    .select()
    .from(usuarios)
    .where(
      or(
        eq(usuarios.email, identificador),
        eq(usuarios.telefono, identificador),
      ),
    )
    .limit(1);
  return usuario;
}
