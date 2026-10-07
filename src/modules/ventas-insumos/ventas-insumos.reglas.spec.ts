// src/modules/ventas-insumos/ventas-insumos.reglas.spec.ts
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { esperarError } from "../../../test/unit/esperar-error";
import { FormaPago } from "./dto/create-venta-insumo.dto";
import {
  exigirProductosSinRepetir,
  validarFormaPago,
  valorizarRenglonVenta,
} from "./ventas-insumos.reglas";

describe("validarFormaPago", () => {
  it("cargo sin cliente: 400", () => {
    esperarError(
      () => validarFormaPago({ forma_pago: FormaPago.CARGO_CLIENTE }),
      BadRequestException,
      "Una venta a cargo del cliente necesita cliente_id",
    );
  });

  it("efectivo con cliente: 400", () => {
    esperarError(
      () =>
        validarFormaPago({ forma_pago: FormaPago.EFECTIVO, cliente_id: "c1" }),
      BadRequestException,
      "Una venta en efectivo no se imputa a ningún cliente",
    );
  });

  it("cargo con cliente pasa", () => {
    expect(() =>
      validarFormaPago({
        forma_pago: FormaPago.CARGO_CLIENTE,
        cliente_id: "c1",
      }),
    ).not.toThrow();
  });

  it("efectivo sin cliente pasa", () => {
    expect(() =>
      validarFormaPago({ forma_pago: FormaPago.EFECTIVO }),
    ).not.toThrow();
  });
});

describe("exigirProductosSinRepetir", () => {
  it("ids repetidos: 400", () => {
    esperarError(
      () => exigirProductosSinRepetir(["a", "b", "a"]),
      BadRequestException,
      "Hay productos repetidos: agrupá la cantidad en un solo renglón",
    );
  });

  it("ids distintos pasan", () => {
    expect(() => exigirProductosSinRepetir(["a", "b", "c"])).not.toThrow();
  });
});

describe("valorizarRenglonVenta", () => {
  const producto = {
    nombre: "Aceite 20W50",
    activo: true,
    stock_actual: 10,
    precio: "45.50",
  };

  it("producto inexistente: 404", () => {
    esperarError(
      () =>
        valorizarRenglonVenta(undefined, { producto_id: "p9", cantidad: 1 }),
      NotFoundException,
      "Producto p9 no encontrado",
    );
  });

  it("producto inactivo: 400", () => {
    esperarError(
      () =>
        valorizarRenglonVenta(
          { ...producto, activo: false },
          { producto_id: "p1", cantidad: 1 },
        ),
      BadRequestException,
      "El producto Aceite 20W50 está descontinuado",
    );
  });

  it("stock menor a lo pedido: 400", () => {
    esperarError(
      () =>
        valorizarRenglonVenta(
          { ...producto, stock_actual: 2 },
          { producto_id: "p1", cantidad: 3 },
        ),
      BadRequestException,
      "Stock insuficiente de Aceite 20W50: hay 2 y se piden 3",
    );
  });

  it("stock justo igual a lo pedido pasa", () => {
    expect(() =>
      valorizarRenglonVenta(
        { ...producto, stock_actual: 3 },
        { producto_id: "p1", cantidad: 3 },
      ),
    ).not.toThrow();
  });

  it("valoriza: precio '45.50' x 2 da unitario 45.5 y subtotal 91", () => {
    const r = valorizarRenglonVenta(producto, {
      producto_id: "p1",
      cantidad: 2,
    });
    expect(r.producto).toBe(producto);
    expect(r.cantidad).toBe(2);
    expect(r.precioUnitario).toBe(45.5);
    expect(r.subtotal).toBe(91);
  });

  it("inactivo y sin stock a la vez: gana descontinuado", () => {
    esperarError(
      () =>
        valorizarRenglonVenta(
          { ...producto, activo: false, stock_actual: 0 },
          { producto_id: "p1", cantidad: 5 },
        ),
      BadRequestException,
      "El producto Aceite 20W50 está descontinuado",
    );
  });
});
