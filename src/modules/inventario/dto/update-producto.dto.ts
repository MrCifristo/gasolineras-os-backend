import { OmitType, PartialType } from "@nestjs/swagger";
import { CreateProductoDto } from "./create-producto.dto";

/**
 * `stock_actual` queda fuera: el stock no se edita a mano, se mueve con
 * POST /inventario/productos/:id/stock, que deja rastro en el kardex. Con
 * `forbidNonWhitelisted`, mandarlo en un PATCH devuelve 400 en vez de
 * cambiar la existencia sin explicación.
 */
export class UpdateProductoDto extends PartialType(
  OmitType(CreateProductoDto, ["stock_actual"] as const),
) {}
