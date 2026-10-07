// src/common/bloqueos.reglas.ts
// Reglas puras compartidas por despachos y ventas de insumos: mismos bloqueos,
// mismos mensajes. Reciben las filas ya leídas; las consultas siguen en el servicio.
import { ForbiddenException, NotFoundException } from "@nestjs/common";

export function exigirRol(
  rol: string | undefined,
  permitidos: readonly string[],
  mensaje: string,
): void {
  if (!rol || !permitidos.includes(rol)) {
    throw new ForbiddenException(mensaje);
  }
}

export function exigirGasolineraOperable<T extends { bloqueado: boolean }>(
  gas: T | undefined,
): asserts gas is T {
  if (!gas) throw new NotFoundException("Gasolinera no encontrada");
  if (gas.bloqueado) {
    throw new ForbiddenException(
      "Gasolinera bloqueada — contacte al administrador",
    );
  }
}

export function exigirClienteConCredito<
  T extends { bloqueado: boolean; credito_bloqueado: boolean },
>(cliente: T | undefined): asserts cliente is T {
  if (!cliente) throw new NotFoundException("Cliente no encontrado");
  if (cliente.bloqueado) {
    throw new ForbiddenException("Cuenta bloqueada por el cliente");
  }
  // Va después del bloqueo de cuenta y con mensaje propio: al supervisor en la
  // bomba le sirve saber si el cliente suspendió su cuenta o si es la
  // estación la que le cortó el crédito, porque el siguiente paso es distinto.
  if (cliente.credito_bloqueado) {
    throw new ForbiddenException(
      "Crédito suspendido — consulte con administración",
    );
  }
}
