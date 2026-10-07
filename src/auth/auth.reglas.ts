// src/auth/auth.reglas.ts
// Reglas puras de autenticación: normalización del identificador y validez del
// token de reset. No leen el reloj (reciben `ahora`) ni la base; las consultas
// siguen en los servicios.
import { BadRequestException } from "@nestjs/common";

/**
 * El identificador puede ser correo o teléfono. Sólo bajamos a minúsculas
 * cuando parece un correo; los teléfonos se comparan tal cual.
 */
export function normalizarIdentificador(texto: string): string {
  const limpio = texto.trim();
  return limpio.includes("@") ? limpio.toLowerCase() : limpio;
}

const ENLACE_INVALIDO = "El enlace de recuperación no es válido o ya venció";

/**
 * Un solo mensaje para token inexistente, usado o vencido: separarlos le diría
 * a quien prueba tokens cuál de los tres está tocando.
 */
export function exigirTokenResetVigente<
  T extends { usado_at: Date | null; expira_at: Date },
>(fila: T | undefined, ahora: Date): asserts fila is T {
  if (!fila || fila.usado_at || fila.expira_at <= ahora) {
    throw new BadRequestException(ENLACE_INVALIDO);
  }
}

/** Mismo mensaje que el token: no delata si la cuenta existe o fue desactivada. */
export function exigirUsuarioActivoParaReset<T extends { activo: boolean }>(
  u: T | undefined,
): asserts u is T {
  if (!u?.activo) {
    throw new BadRequestException(ENLACE_INVALIDO);
  }
}
