// src/modules/precios-combustible/precios-combustible.reglas.ts
// Reglas puras de los precios de combustible: sin base de datos ni reloj.
import { BadRequestException } from "@nestjs/common";

/**
 * Un precio en cero (o negativo, o no numérico) haría que `valorizarRenglon`
 * dividiera entre cero al derivar los galones de un despacho.
 */
export function validarPrecioGalon(precio: string): void {
  // La columna es numeric(10,3): 0.0004 se guardaría como 0.000.
  if (!(Number(Number(precio).toFixed(3)) > 0)) {
    throw new BadRequestException("El precio por galón debe ser mayor a cero");
  }
}
