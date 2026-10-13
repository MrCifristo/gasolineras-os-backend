// src/modules/clientes/clientes.reglas.ts
// Reglas puras de clientes: el NIT único. Las consultas siguen en el servicio.
import { ConflictException } from "@nestjs/common";
import {
  esViolacionUnica,
  restriccionPg,
} from "../../common/errores-pg.reglas";

/** Índice único del NIT (migración 0010). */
export const INDICE_NIT_UNICO = "clientes_nit_unico";

/** El NIT se guarda en mayúsculas (el dígito verificador puede ser "K"). */
export function normalizarNit<T>(nit: T): T | string {
  return typeof nit === "string" ? nit.trim().toUpperCase() : nit;
}

/**
 * Clave con la que se compara un NIT: mayúsculas y sin guiones, igual que la
 * expresión del índice `clientes_nit_unico`. `null` si no participa de la
 * unicidad: sin NIT, o "CF" (consumidor final), que puede repetirse.
 */
export function claveNit(nit: string | null | undefined): string | null {
  if (typeof nit !== "string") return null;
  const clave = nit.trim().toUpperCase().replace(/-/g, "");
  return clave === "" || clave === "CF" ? null : clave;
}

/**
 * 409 cuando el NIT ya es de otro cliente. Si ese cliente está desactivado, la
 * salida es reactivarlo, no registrarlo de nuevo.
 */
export function errorPorNitDuplicado(
  nit: string,
  existente: { nombre: string; activo: boolean | null },
): ConflictException {
  if (existente.activo === false)
    return new ConflictException(
      `El NIT ${nit} es de ${existente.nombre}, que está desactivado. Reactívalo desde la lista de clientes.`,
    );
  return new ConflictException(
    `Ya existe un cliente con el NIT ${nit} (${existente.nombre}).`,
  );
}

/**
 * 23505 del índice del NIT -> 409 (la consulta previa no ve una carrera entre
 * dos altas). Devuelve el error original si es otro.
 */
export function errorPorNitDuplicadoPg(error: unknown): unknown {
  if (esViolacionUnica(error) && restriccionPg(error) === INDICE_NIT_UNICO)
    return new ConflictException("Ya existe un cliente con ese NIT.");
  return error;
}
