// src/modules/ventas-insumos/ventas-insumos.reglas.ts
// Reglas puras de la venta de insumos. Reciben datos ya leídos; las consultas y
// la transacción siguen en el servicio.
import { BadRequestException, NotFoundException } from "@nestjs/common";
import type { productos } from "../../db/schema";
import { FormaPago } from "./dto/create-venta-insumo.dto";

type ProductoRow = typeof productos.$inferSelect;

// El cliente sólo tiene sentido cuando se le carga a su cuenta. Exigirlo en
// cargo y prohibirlo en efectivo evita ventas de contado imputadas por error.
export function validarFormaPago(dto: {
  forma_pago: FormaPago;
  cliente_id?: string | null;
}): void {
  if (dto.forma_pago === FormaPago.CARGO_CLIENTE && !dto.cliente_id) {
    throw new BadRequestException(
      "Una venta a cargo del cliente necesita cliente_id",
    );
  }
  if (dto.forma_pago === FormaPago.EFECTIVO && dto.cliente_id) {
    throw new BadRequestException(
      "Una venta en efectivo no se imputa a ningún cliente",
    );
  }
}

// Una línea por producto: dos renglones del mismo producto descuadrarían la
// verificación de stock, que mira cada producto una sola vez.
export function exigirProductosSinRepetir(ids: string[]): void {
  if (new Set(ids).size !== ids.length) {
    throw new BadRequestException(
      "Hay productos repetidos: agrupá la cantidad en un solo renglón",
    );
  }
}

export function valorizarRenglonVenta<
  P extends Pick<ProductoRow, "nombre" | "activo" | "stock_actual" | "precio">,
>(
  producto: P | undefined,
  d: { producto_id: string; cantidad: number },
): { producto: P; cantidad: number; precioUnitario: number; subtotal: number } {
  if (!producto) {
    throw new NotFoundException(`Producto ${d.producto_id} no encontrado`);
  }
  if (!producto.activo) {
    throw new BadRequestException(
      `El producto ${producto.nombre} está descontinuado`,
    );
  }
  if (producto.stock_actual < d.cantidad) {
    throw new BadRequestException(
      `Stock insuficiente de ${producto.nombre}: hay ${producto.stock_actual} y se piden ${d.cantidad}`,
    );
  }
  const precioUnitario = parseFloat(producto.precio);
  return {
    producto,
    cantidad: d.cantidad,
    precioUnitario,
    subtotal: precioUnitario * d.cantidad,
  };
}
