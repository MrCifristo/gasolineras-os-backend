// src/modules/pilotos/pilotos.reglas.ts
// Reglas puras de alcance del cliente sobre sus pilotos.
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";

type Usuario = { rol: string; cliente_id?: string | null };

/**
 * Alcance fail-closed: el admin no se acota (null); cualquier otro rol queda
 * acotado a su cliente_id y, sin él, no ve nada (404).
 */
export function clienteIdDeAlcancePiloto(user: Usuario): string | null {
  if (user.rol === "admin") return null;
  if (!user.cliente_id) throw new NotFoundException("Piloto no encontrado");
  return user.cliente_id;
}

/** El cliente crea siempre a su nombre; el admin elige la empresa. */
export function clienteIdParaCrearPiloto(
  user: Usuario,
  clienteIdDelBody?: string | null,
): string {
  const delAlcance = clienteIdDeAlcancePiloto(user);
  if (delAlcance) return delAlcance;
  if (!clienteIdDelBody)
    throw new BadRequestException("cliente_id es obligatorio");
  return clienteIdDelBody;
}

/** Un cliente no puede mover un piloto a otra empresa. */
export function rechazarOtraEmpresaPiloto(
  user: Usuario,
  clienteIdDelBody?: string | null,
): void {
  if (
    user.rol === "cliente" &&
    clienteIdDelBody != null &&
    clienteIdDelBody !== user.cliente_id
  )
    throw new ForbiddenException("No puede asignar el piloto a otra empresa");
}
