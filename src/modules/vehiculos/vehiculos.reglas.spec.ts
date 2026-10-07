// src/modules/vehiculos/vehiculos.reglas.spec.ts
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { esperarError } from "../../../test/unit/esperar-error";
import {
  clienteIdDeAlcance,
  clienteIdParaCrear,
  errorPorPlacaDuplicada,
  normalizarPlaca,
  rechazarCambioDePlaca,
  rechazarOtraEmpresa,
  coercerDecimales,
  intentaDesbloquear,
  plantillaDesdeCliente,
  rechazarBloqueadoNulo,
} from "./vehiculos.reglas";

describe("coercerDecimales", () => {
  it("pasa los decimales a string", () => {
    expect(coercerDecimales({ limite_monto_dia: 100.5 })).toEqual({
      limite_monto_dia: "100.5",
    });
  });

  it("no cambia los enteros de transacciones ni los demás campos", () => {
    expect(coercerDecimales({ limite_trans_dia: 3, placa: "P123ABC" })).toEqual(
      { limite_trans_dia: 3, placa: "P123ABC" },
    );
  });

  it("deja null como null", () => {
    expect(coercerDecimales({ limite_monto_mes: null })).toEqual({
      limite_monto_mes: null,
    });
  });

  it("no muta la entrada", () => {
    const entrada = { limite_volumen_dia: 50 };
    coercerDecimales(entrada);
    expect(entrada).toEqual({ limite_volumen_dia: 50 });
  });
});

describe("rechazarBloqueadoNulo", () => {
  it("rechaza null con 400", () => {
    esperarError(
      () => rechazarBloqueadoNulo({ bloqueado: null }),
      BadRequestException,
      "bloqueado debe ser verdadero o falso",
    );
  });

  it.each([undefined, true, false])("deja pasar %s", (bloqueado) => {
    expect(() => rechazarBloqueadoNulo({ bloqueado })).not.toThrow();
  });
});

describe("clienteIdDeAlcance", () => {
  it("el admin no tiene alcance acotado", () => {
    expect(clienteIdDeAlcance({ rol: "admin" })).toBeNull();
  });

  it("el cliente queda acotado a su cliente_id", () => {
    expect(clienteIdDeAlcance({ rol: "cliente", cliente_id: "c1" })).toBe("c1");
  });

  it("un cliente sin empresa recibe 404", () => {
    esperarError(
      () => clienteIdDeAlcance({ rol: "cliente", cliente_id: null }),
      NotFoundException,
      "Vehículo no encontrado",
    );
  });

  it("un supervisor sin cliente_id recibe 404 (falla cerrado)", () => {
    esperarError(
      () => clienteIdDeAlcance({ rol: "supervisor" }),
      NotFoundException,
      "Vehículo no encontrado",
    );
  });
});

describe("intentaDesbloquear", () => {
  it("sólo el cliente con bloqueado=false intenta desbloquear", () => {
    expect(intentaDesbloquear({ rol: "cliente" }, { bloqueado: false })).toBe(
      true,
    );
  });

  it("el cliente que bloquea no desbloquea", () => {
    expect(intentaDesbloquear({ rol: "cliente" }, { bloqueado: true })).toBe(
      false,
    );
  });

  it("el admin puede desbloquear", () => {
    expect(intentaDesbloquear({ rol: "admin" }, { bloqueado: false })).toBe(
      false,
    );
  });

  it("un cliente que no toca bloqueado no desbloquea", () => {
    expect(intentaDesbloquear({ rol: "cliente" }, {})).toBe(false);
  });
});

describe("plantillaDesdeCliente", () => {
  const vacia = {
    plantilla_monto_transaccion: null,
    plantilla_monto_dia: null,
    plantilla_monto_semana: null,
    plantilla_monto_mes: null,
    plantilla_volumen_transaccion: null,
    plantilla_volumen_dia: null,
    plantilla_volumen_semana: null,
    plantilla_volumen_mes: null,
    plantilla_trans_dia: null,
    plantilla_trans_semana: null,
    plantilla_trans_mes: null,
    plantilla_productos_permitidos: null,
  };

  it("sin cliente devuelve una plantilla vacía", () => {
    expect(plantillaDesdeCliente(undefined)).toEqual({});
  });

  it("parsea los decimales que llegan como string", () => {
    expect(
      plantillaDesdeCliente({
        ...vacia,
        plantilla_monto_dia: "500.00",
        plantilla_volumen_mes: "12.5",
      }),
    ).toEqual({ limite_monto_dia: 500, limite_volumen_mes: 12.5 });
  });

  it("copia los enteros de transacciones", () => {
    expect(
      plantillaDesdeCliente({
        ...vacia,
        plantilla_trans_dia: 2,
        plantilla_trans_semana: 10,
        plantilla_trans_mes: 40,
      }),
    ).toEqual({
      limite_trans_dia: 2,
      limite_trans_semana: 10,
      limite_trans_mes: 40,
    });
  });

  it("omite los campos null", () => {
    expect(plantillaDesdeCliente(vacia)).toEqual({});
  });

  it("omite productos vacíos y copia los que existen", () => {
    expect(
      plantillaDesdeCliente({ ...vacia, plantilla_productos_permitidos: [] }),
    ).toEqual({});
    expect(
      plantillaDesdeCliente({
        ...vacia,
        plantilla_productos_permitidos: ["diesel"],
      }),
    ).toEqual({ productos_permitidos: ["diesel"] });
  });

  it("cubre los ocho decimales de monto y volumen", () => {
    const r = plantillaDesdeCliente({
      ...vacia,
      plantilla_monto_transaccion: "1",
      plantilla_monto_dia: "2",
      plantilla_monto_semana: "3",
      plantilla_monto_mes: "4",
      plantilla_volumen_transaccion: "5",
      plantilla_volumen_dia: "6",
      plantilla_volumen_semana: "7",
      plantilla_volumen_mes: "8",
    });
    expect(r).toEqual({
      limite_monto_transaccion: 1,
      limite_monto_dia: 2,
      limite_monto_semana: 3,
      limite_monto_mes: 4,
      limite_volumen_transaccion: 5,
      limite_volumen_dia: 6,
      limite_volumen_semana: 7,
      limite_volumen_mes: 8,
    });
  });
});

describe("clienteIdParaCrear", () => {
  it("el cliente crea a su nombre, pisando el del body", () => {
    expect(clienteIdParaCrear({ rol: "cliente", cliente_id: "c1" }, "c2")).toBe(
      "c1",
    );
  });

  it("el cliente sin empresa recibe 404", () => {
    esperarError(
      () => clienteIdParaCrear({ rol: "cliente", cliente_id: null }, "c2"),
      NotFoundException,
      "Vehículo no encontrado",
    );
  });

  it("el admin usa el cliente_id del body", () => {
    expect(clienteIdParaCrear({ rol: "admin" }, "c2")).toBe("c2");
  });

  it("el admin sin cliente_id recibe 400", () => {
    esperarError(
      () => clienteIdParaCrear({ rol: "admin" }),
      BadRequestException,
      "cliente_id es obligatorio",
    );
  });
});

describe("rechazarOtraEmpresa", () => {
  const cliente = { rol: "cliente", cliente_id: "c1" };

  it("el cliente no puede asignar otra empresa: 403", () => {
    esperarError(
      () => rechazarOtraEmpresa(cliente, "c2"),
      ForbiddenException,
      "No puede asignar el vehículo a otra empresa",
    );
  });

  it("permite su propia empresa, el body sin cliente_id y al admin", () => {
    expect(() => rechazarOtraEmpresa(cliente, "c1")).not.toThrow();
    expect(() => rechazarOtraEmpresa(cliente, undefined)).not.toThrow();
    expect(() => rechazarOtraEmpresa({ rol: "admin" }, "c2")).not.toThrow();
  });
});

describe("rechazarOtraEmpresa con null", () => {
  it("el cliente recibe 403", () => {
    esperarError(
      () => rechazarOtraEmpresa({ rol: "cliente", cliente_id: "c1" }, null),
      ForbiddenException,
      "No puede asignar el vehículo a otra empresa",
    );
  });

  it("el admin recibe 400", () => {
    esperarError(
      () => rechazarOtraEmpresa({ rol: "admin" }, null),
      BadRequestException,
      "cliente_id no puede ser nulo",
    );
  });
});

describe("normalizarPlaca", () => {
  it("recorta y pasa a mayúsculas sin quitar guiones", () => {
    expect(normalizarPlaca("  p-123abc ")).toBe("P-123ABC");
  });

  it("deja pasar lo que no es string", () => {
    expect(normalizarPlaca(undefined)).toBeUndefined();
  });
});

describe("rechazarCambioDePlaca", () => {
  it("el cliente que cambia la placa recibe 403", () => {
    esperarError(
      () => rechazarCambioDePlaca({ rol: "cliente" }, "P-999ZZZ", "P-123ABC"),
      ForbiddenException,
      "Sólo la estación puede cambiar la placa de un vehículo.",
    );
  });

  it("la misma placa, normalizada, no cuenta como cambio", () => {
    expect(() =>
      rechazarCambioDePlaca({ rol: "cliente" }, " p-123abc", "P-123ABC"),
    ).not.toThrow();
  });

  it("el admin puede cambiarla", () => {
    expect(() =>
      rechazarCambioDePlaca({ rol: "admin" }, "P-999ZZZ", "P-123ABC"),
    ).not.toThrow();
  });
});

describe("errorPorPlacaDuplicada", () => {
  it("23505 (directo o en cause) pasa a 409", () => {
    for (const e of [{ code: "23505" }, { cause: { code: "23505" } }]) {
      esperarError(
        () => {
          throw errorPorPlacaDuplicada(e);
        },
        ConflictException,
        "Ya existe un vehículo con esa placa",
      );
    }
  });

  it("otro error se devuelve tal cual", () => {
    const e = new Error("x");
    expect(errorPorPlacaDuplicada(e)).toBe(e);
    expect(errorPorPlacaDuplicada(undefined)).toBeUndefined();
  });
});
