// src/modules/tipos-vehiculo/tipos-vehiculo.reglas.ts
// Reglas puras del catálogo de tipos de vehículo.
import { BadRequestException, ConflictException } from "@nestjs/common";
import {
  esViolacionUnica,
  restriccionPg,
} from "../../common/errores-pg.reglas";

/** Índice único del nombre entre los tipos activos (migración 0011). */
export const INDICE_NOMBRE_TIPO = "tipos_vehiculo_nombre_unico";

/** "  Camión   de Carga " -> "Camión de Carga". Vacío -> 400. */
export function normalizarNombreTipo(nombre: string): string {
  const limpio = nombre.trim().replace(/\s+/g, " ");
  if (!limpio)
    throw new BadRequestException(
      "El nombre del tipo de vehículo es obligatorio",
    );
  return limpio;
}

/** 23505 del índice del nombre -> 409. Devuelve el error original si es otro. */
export function errorPorTipoDuplicado(error: unknown, nombre: string): unknown {
  if (esViolacionUnica(error) && restriccionPg(error) === INDICE_NOMBRE_TIPO)
    return new ConflictException(`Ya existe el tipo de vehículo "${nombre}"`);
  return error;
}
