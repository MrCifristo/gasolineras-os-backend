// src/auth/session.reglas.ts
// Reglas puras de sesión: vencimientos y validaciones de la rotación. No leen
// el reloj (reciben `ahora`) ni la base; las consultas siguen en el servicio.
import { UnauthorizedException } from "@nestjs/common";
import type { sesiones, usuarios } from "../db/schema";
// `import type`: roles.decorator importa guards; un import de valor crearía un ciclo.
import type { Role } from "./roles.decorator";

type SesionRow = typeof sesiones.$inferSelect;
type UsuarioRow = typeof usuarios.$inferSelect;

/** El supervisor vive en una tablet en la bomba: no debe reloguear a media jornada. */
export const REFRESH_TTL_DIAS: Record<Role, number> = {
  supervisor: 30,
  admin: 7,
  cliente: 7,
  jefe_pista: 7,
};

/**
 * Tope duro de la familia. La rotación desliza `expira_at`, así que sin este
 * techo una familia activa se renovaría para siempre y una robada también.
 */
export const FAMILIA_TTL_DIAS: Record<Role, number> = {
  supervisor: 90,
  admin: 30,
  cliente: 30,
  jefe_pista: 30,
};

const dias = (n: number) => n * 24 * 60 * 60 * 1000;

/**
 * Señal interna de replay. Lleva la familia a revocar para poder hacerlo fuera
 * de la transacción de rotación: si se revocara adentro, lanzar la excepción
 * haría rollback y la familia quedaría viva.
 */
export class ReplayError extends Error {
  constructor(readonly familiaId: string) {
    super("replay");
  }
}

export function vencimientosIniciales(
  rol: Role,
  ahora: Date,
): { expira: Date; familiaExpira: Date } {
  return {
    expira: new Date(ahora.getTime() + dias(REFRESH_TTL_DIAS[rol])),
    familiaExpira: new Date(ahora.getTime() + dias(FAMILIA_TTL_DIAS[rol])),
  };
}

export function validarSesionParaRotar<
  S extends Pick<
    SesionRow,
    | "revocado_at"
    | "usado_at"
    | "familia_id"
    | "expira_at"
    | "familia_expira_at"
  >,
>(sesion: S | undefined, ahora: Date): asserts sesion is S {
  if (!sesion) throw new UnauthorizedException("Sesión inválida");
  if (sesion.revocado_at) throw new UnauthorizedException("Sesión revocada");

  // Replay: este refresh ya se canjeó. O lo robaron y lo están reusando, o
  // el legítimo se reenvió. No hay forma de distinguirlos, así que se cae
  // toda la familia: es preferible un relogin a dejar viva una cadena robada.
  if (sesion.usado_at) {
    throw new ReplayError(sesion.familia_id);
  }

  if (sesion.expira_at <= ahora) {
    throw new UnauthorizedException("Sesión expirada");
  }
  if (sesion.familia_expira_at <= ahora) {
    throw new UnauthorizedException("Sesión expirada");
  }
}

export function validarUsuarioDeSesion<
  U extends Pick<UsuarioRow, "activo" | "password_actualizado_at">,
>(usuario: U | undefined, sesionCreadaAt: Date): asserts usuario is U {
  if (!usuario || !usuario.activo) {
    throw new UnauthorizedException("Usuario inactivo");
  }

  // Respaldo por si algún camino cambia la contraseña sin revocar sesiones.
  if (
    !sesionPosteriorAlPassword(sesionCreadaAt, usuario.password_actualizado_at)
  ) {
    throw new UnauthorizedException("Sesión anterior al cambio de contraseña");
  }
}

export function sesionPosteriorAlPassword(
  creadoAt: Date,
  passwordActualizadoAt: Date,
): boolean {
  return !(creadoAt < passwordActualizadoAt);
}

/** Desliza el vencimiento, pero nunca más allá del techo de la familia. */
export function vencimientoRotado(
  rol: Role,
  ahora: Date,
  familiaExpiraAt: Date,
): Date {
  const deseado = new Date(ahora.getTime() + dias(REFRESH_TTL_DIAS[rol]));
  return deseado > familiaExpiraAt ? familiaExpiraAt : deseado;
}
