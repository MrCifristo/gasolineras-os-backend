// src/modules/despachos/despachos.reglas.spec.ts
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { esperarError } from "../../../test/unit/esperar-error";
import {
  aNumero,
  DIAS_GT,
  diaYMinutoGuatemala,
  exigirOperarioDeLaGasolinera,
  exigirPrecio,
  exigirSistemaActivo,
  exigirVehiculoHabilitado,
  necesitaAgregadoCliente,
  normalizarRenglones,
  resumenRenglones,
  totalesDespacho,
  validarHorarioVehiculo,
  validarLimitesCliente,
  validarLimitesTransaccion,
  validarParVehiculoPiloto,
  validarProductosPermitidos,
  valorizarRenglon,
  type LineaDespacho,
} from "./despachos.reglas";

describe("exigirSistemaActivo", () => {
  it("deja pasar si no hay fila de configuración", () => {
    expect(() => exigirSistemaActivo(undefined)).not.toThrow();
  });

  it("deja pasar si el sistema no está bloqueado", () => {
    expect(() =>
      exigirSistemaActivo({ sistema_bloqueado: false }),
    ).not.toThrow();
  });

  it("rechaza con 403 si el sistema está bloqueado", () => {
    esperarError(
      () => exigirSistemaActivo({ sistema_bloqueado: true }),
      ForbiddenException,
      "Sistema suspendido — contacte al administrador",
    );
  });
});

describe("exigirOperarioDeLaGasolinera", () => {
  it("rechaza con 400 si no hay operario", () => {
    esperarError(
      () => exigirOperarioDeLaGasolinera(undefined),
      BadRequestException,
      "El operario no pertenece a esta gasolinera o está inactivo.",
    );
  });

  it("deja pasar si hay fila", () => {
    expect(() => exigirOperarioDeLaGasolinera({ id: "op-1" })).not.toThrow();
  });
});

describe("normalizarRenglones", () => {
  const vehiculo: LineaDespacho = {
    renglon: "vehiculo",
    tipo_combustible: "diesel",
    monto: "100",
  };
  const caneca: LineaDespacho = {
    renglon: "caneca",
    tipo_combustible: "super",
    monto: "50",
  };

  it("lleva la forma vieja a un único renglón vehiculo", () => {
    expect(
      normalizarRenglones({ tipo_combustible: "diesel", monto: "100" }),
    ).toEqual([vehiculo]);
  });

  it("devuelve los detalles en el mismo orden", () => {
    expect(normalizarRenglones({ detalles: [vehiculo, caneca] })).toEqual([
      vehiculo,
      caneca,
    ]);
  });

  it("rechaza con 400 las dos formas a la vez", () => {
    esperarError(
      () =>
        normalizarRenglones({
          tipo_combustible: "diesel",
          monto: "100",
          detalles: [caneca],
        }),
      BadRequestException,
      "Mandá `detalles` o `tipo_combustible`+`monto`, no las dos formas",
    );
  });

  it("rechaza con 400 sólo tipo_combustible sin monto", () => {
    esperarError(
      () => normalizarRenglones({ tipo_combustible: "diesel" }),
      BadRequestException,
      "Falta el detalle del despacho: mandá `detalles`, o `tipo_combustible` y `monto`",
    );
  });

  it("rechaza con 400 detalles vacíos sin forma vieja", () => {
    esperarError(
      () => normalizarRenglones({ detalles: [] }),
      BadRequestException,
      "Falta el detalle del despacho: mandá `detalles`, o `tipo_combustible` y `monto`",
    );
  });

  it("detalles vacíos con forma vieja usa la forma vieja", () => {
    expect(
      normalizarRenglones({
        tipo_combustible: "diesel",
        monto: "100",
        detalles: [],
      }),
    ).toEqual([vehiculo]);
  });
});

describe("validarParVehiculoPiloto", () => {
  const conVehiculo: LineaDespacho[] = [
    { renglon: "vehiculo", tipo_combustible: "diesel", monto: "100" },
  ];
  const soloCanecas: LineaDespacho[] = [
    { renglon: "caneca", tipo_combustible: "super", monto: "50" },
  ];

  it.each([{ vehiculo_id: "v-1" }, { piloto_id: "p-1" }])(
    "rechaza con 400 si vehículo y piloto no vienen juntos (%o)",
    (dto) => {
      esperarError(
        () => validarParVehiculoPiloto(dto, conVehiculo),
        BadRequestException,
        "Vehículo y piloto deben venir juntos o ninguno de los dos",
      );
    },
  );

  it("rechaza con 400 un renglón vehiculo sin vehiculo_id", () => {
    esperarError(
      () => validarParVehiculoPiloto({}, conVehiculo),
      BadRequestException,
      "El renglón de vehículo requiere vehiculo_id y piloto_id",
    );
  });

  it("rechaza con 400 vehiculo_id con sólo canecas", () => {
    esperarError(
      () =>
        validarParVehiculoPiloto(
          { vehiculo_id: "v-1", piloto_id: "p-1" },
          soloCanecas,
        ),
      BadRequestException,
      "Se indicó vehículo pero ningún renglón le despacha combustible",
    );
  });

  it("deja pasar sólo canecas sin vehículo", () => {
    expect(() => validarParVehiculoPiloto({}, soloCanecas)).not.toThrow();
  });

  it("deja pasar vehículo + piloto + renglón vehiculo", () => {
    expect(() =>
      validarParVehiculoPiloto(
        { vehiculo_id: "v-1", piloto_id: "p-1" },
        conVehiculo,
      ),
    ).not.toThrow();
  });
});

describe("resumenRenglones", () => {
  it("une los renglones con + y etiqueta los que no son vehículo", () => {
    expect(
      resumenRenglones([
        { renglon: "vehiculo", tipo_combustible: "diesel", galones: 80 },
        { renglon: "caneca", tipo_combustible: "super", galones: 5 },
      ]),
    ).toBe("diesel 80.000 gal + caneca super 5.000 gal");
  });

  it("con un solo renglón no lleva +", () => {
    expect(
      resumenRenglones([
        { renglon: "vehiculo", tipo_combustible: "diesel", galones: 80 },
      ]),
    ).toBe("diesel 80.000 gal");
  });
});

// El 2026-10-07 es miércoles. 14:00Z = 08:00 GT (UTC−6).
const MIERCOLES_0800_GT = new Date("2026-10-07T14:00:00Z");
// 18:30 GT del miércoles; en UTC ya es jueves.
const MIERCOLES_1830_GT = new Date("2026-10-08T00:30:00Z");

describe("diaYMinutoGuatemala", () => {
  it("DIAS_GT empieza en domingo y tiene los siete días", () => {
    expect(DIAS_GT).toEqual([
      "domingo",
      "lunes",
      "martes",
      "miercoles",
      "jueves",
      "viernes",
      "sabado",
    ]);
  });

  it("da el día y los minutos de Guatemala", () => {
    expect(diaYMinutoGuatemala(MIERCOLES_0800_GT)).toEqual({
      dia: "miercoles",
      minutos: 480,
    });
  });

  it("a las 18:30 GT sigue siendo miércoles aunque en UTC sea jueves", () => {
    expect(diaYMinutoGuatemala(MIERCOLES_1830_GT)).toEqual({
      dia: "miercoles",
      minutos: 1110,
    });
  });
});

describe("exigirVehiculoHabilitado", () => {
  it("rechaza con 404 si el vehículo no existe", () => {
    esperarError(
      () => exigirVehiculoHabilitado(undefined),
      NotFoundException,
      "Vehículo no encontrado",
    );
  });

  it("rechaza con 403 si el vehículo está bloqueado", () => {
    esperarError(
      () => exigirVehiculoHabilitado({ bloqueado: true }),
      ForbiddenException,
      "Vehículo bloqueado — consulte con su administrador",
    );
  });

  it("deja pasar un vehículo habilitado", () => {
    expect(() => exigirVehiculoHabilitado({ bloqueado: false })).not.toThrow();
  });
});

describe("validarProductosPermitidos", () => {
  const vehiculoDiesel: LineaDespacho = {
    renglon: "vehiculo",
    tipo_combustible: "diesel",
    monto: "100.00",
  };

  it("sin restricción si la lista es null", () => {
    expect(() =>
      validarProductosPermitidos({ productos_permitidos: null }, [
        { ...vehiculoDiesel, tipo_combustible: "super" },
      ]),
    ).not.toThrow();
  });

  it("sin restricción si la lista está vacía", () => {
    expect(() =>
      validarProductosPermitidos({ productos_permitidos: [] }, [
        { ...vehiculoDiesel, tipo_combustible: "super" },
      ]),
    ).not.toThrow();
  });

  it("deja pasar el combustible permitido en el renglón vehículo", () => {
    expect(() =>
      validarProductosPermitidos({ productos_permitidos: ["diesel"] }, [
        vehiculoDiesel,
      ]),
    ).not.toThrow();
  });

  it("rechaza con 403 un combustible no permitido en el renglón vehículo", () => {
    esperarError(
      () =>
        validarProductosPermitidos({ productos_permitidos: ["diesel"] }, [
          { ...vehiculoDiesel, tipo_combustible: "super" },
        ]),
      ForbiddenException,
      "Este vehículo no puede cargar super",
    );
  });

  it("no restringe una caneca: ahí puede ir otro combustible", () => {
    expect(() =>
      validarProductosPermitidos({ productos_permitidos: ["diesel"] }, [
        { renglon: "caneca", tipo_combustible: "super", monto: "50.00" },
      ]),
    ).not.toThrow();
  });
});

describe("validarHorarioVehiculo", () => {
  const ventana = (hora_inicio: string | null, hora_fin: string | null) => ({
    dias_permitidos: null,
    hora_inicio,
    hora_fin,
  });
  // Instante UTC que corresponde a esa hora de reloj en Guatemala (UTC−6).
  const gt = (fecha: string, hhmm: string) =>
    new Date(new Date(`${fecha}T${hhmm}:00Z`).getTime() + 6 * 3600 * 1000);

  it("sin vehículo no hay restricción", () => {
    expect(() => validarHorarioVehiculo(null, MIERCOLES_0800_GT)).not.toThrow();
  });

  it("deja pasar un día permitido", () => {
    expect(() =>
      validarHorarioVehiculo(
        {
          dias_permitidos: ["lunes", "miercoles"],
          hora_inicio: null,
          hora_fin: null,
        },
        MIERCOLES_0800_GT,
      ),
    ).not.toThrow();
  });

  it("juzga el día de Guatemala, no el de UTC", () => {
    esperarError(
      () =>
        validarHorarioVehiculo(
          { dias_permitidos: ["jueves"], hora_inicio: null, hora_fin: null },
          MIERCOLES_1830_GT,
        ),
      ForbiddenException,
      "Despacho no permitido hoy (miercoles) para este vehículo",
    );
  });

  it("la ventana es inclusiva en los dos extremos", () => {
    const v = ventana("06:00", "18:00");
    expect(() =>
      validarHorarioVehiculo(v, gt("2026-10-07", "06:00")),
    ).not.toThrow();
    expect(() => validarHorarioVehiculo(v, MIERCOLES_0800_GT)).not.toThrow();
    expect(() =>
      validarHorarioVehiculo(v, gt("2026-10-07", "18:00")),
    ).not.toThrow();
  });

  it("rechaza 05:59 y 18:01 con el mensaje del horario", () => {
    const v = ventana("06:00", "18:00");
    for (const hora of ["05:59", "18:01"]) {
      esperarError(
        () => validarHorarioVehiculo(v, gt("2026-10-07", hora)),
        ForbiddenException,
        "Despacho fuera del horario autorizado (06:00–18:00)",
      );
    }
  });

  it("sólo hora_inicio, sin hora_fin, no restringe", () => {
    expect(() =>
      validarHorarioVehiculo(ventana("06:00", null), gt("2026-10-07", "09:00")),
    ).not.toThrow();
  });

  it("si el día no es permitido y además está fuera de hora, gana el mensaje del día", () => {
    esperarError(
      () =>
        validarHorarioVehiculo(
          {
            dias_permitidos: ["jueves"],
            hora_inicio: "06:00",
            hora_fin: "07:00",
          },
          MIERCOLES_0800_GT,
        ),
      ForbiddenException,
      "Despacho no permitido hoy (miercoles) para este vehículo",
    );
  });

  it("HALLAZGO H1: una ventana que cruza la medianoche (22:00–06:00) rechaza siempre, incluso a las 23:00 GT", () => {
    // 23:00 GT = 05:00Z del día siguiente.
    esperarError(
      () =>
        validarHorarioVehiculo(
          ventana("22:00", "06:00"),
          new Date("2026-10-08T05:00:00Z"),
        ),
      ForbiddenException,
      "Despacho fuera del horario autorizado (22:00–06:00)",
    );
  });
});

describe("exigirPrecio", () => {
  it("rechaza si no hay precio del día, con el combustible en el mensaje", () => {
    esperarError(
      () => exigirPrecio(undefined, "diesel"),
      BadRequestException,
      "No hay precio registrado para diesel hoy en esta gasolinera",
    );
  });

  it("deja pasar si hay fila de precio", () => {
    expect(() => exigirPrecio({ precio_galon: "25" }, "diesel")).not.toThrow();
  });
});

describe("valorizarRenglon", () => {
  it("deriva los galones del monto y el precio del servidor", () => {
    expect(valorizarRenglon("100", "25")).toEqual({ monto: 100, galones: 4 });
  });

  it.each(["0", "-5", "abc"])("rechaza el monto %p", (monto) => {
    esperarError(
      () => valorizarRenglon(monto, "25"),
      BadRequestException,
      "El monto de cada renglón debe ser mayor a cero",
    );
  });

  it("HALLAZGO H2: con precio 0 los galones son Infinity", () => {
    expect(valorizarRenglon("100", "0").galones).toBe(Infinity);
  });
});

describe("totalesDespacho", () => {
  it("suma el vale entero y aparte lo del vehículo", () => {
    expect(
      totalesDespacho([
        { renglon: "vehiculo", monto: 100, galones: 4 },
        { renglon: "caneca", monto: 50, galones: 2 },
      ]),
    ).toEqual({
      montoEstimado: 150,
      galonesEstimado: 6,
      montoTotal: "150.000",
      montoVehiculo: 100,
      galonesVehiculo: 4,
    });
  });

  it("sin renglón de vehículo, lo del vehículo es cero", () => {
    const t = totalesDespacho([{ renglon: "caneca", monto: 50, galones: 2 }]);
    expect(t.montoVehiculo).toBe(0);
    expect(t.galonesVehiculo).toBe(0);
    expect(t.montoEstimado).toBe(50);
  });

  it("montoTotal siempre lleva 3 decimales", () => {
    expect(
      totalesDespacho([{ renglon: "vehiculo", monto: 10.5, galones: 1 }])
        .montoTotal,
    ).toBe("10.500");
  });
});

describe("aNumero", () => {
  it("null y undefined dan null", () => {
    expect(aNumero(null)).toBeNull();
    expect(aNumero(undefined)).toBeNull();
  });

  it("convierte el numérico que llega como string", () => {
    expect(aNumero("12.50")).toBe(12.5);
  });

  it("deja pasar un número", () => {
    expect(aNumero(3)).toBe(3);
  });
});

describe("necesitaAgregadoCliente", () => {
  const sin = {
    limite_monto_dia: null,
    limite_monto_semana: null,
    limite_monto_mes: null,
  };

  it("sin ningún límite de cuenta no hace falta la consulta", () => {
    expect(necesitaAgregadoCliente(sin)).toBe(false);
  });

  it.each(["limite_monto_dia", "limite_monto_semana", "limite_monto_mes"])(
    "con %s basta para necesitarla",
    (campo) => {
      expect(necesitaAgregadoCliente({ ...sin, [campo]: "100.00" })).toBe(true);
    },
  );
});

describe("validarLimitesCliente", () => {
  const sin = {
    limite_monto_dia: null,
    limite_monto_semana: null,
    limite_monto_mes: null,
  };
  const consumo = { monto_dia: "400", monto_semana: "400", monto_mes: "400" };

  it("justo en el límite diario pasa", () => {
    expect(() =>
      validarLimitesCliente(
        { ...sin, limite_monto_dia: "500.00" },
        consumo,
        100,
      ),
    ).not.toThrow();
  });

  it("pasarse del límite diario es 403", () => {
    esperarError(
      () =>
        validarLimitesCliente(
          { ...sin, limite_monto_dia: "500.00" },
          consumo,
          100.01,
        ),
      ForbiddenException,
      "Límite diario de la cuenta superado",
    );
  });

  it("pasarse del límite semanal es 403", () => {
    esperarError(
      () =>
        validarLimitesCliente(
          { ...sin, limite_monto_semana: "500.00" },
          consumo,
          100.01,
        ),
      ForbiddenException,
      "Límite semanal de la cuenta superado",
    );
  });

  it("pasarse del límite mensual es 403", () => {
    esperarError(
      () =>
        validarLimitesCliente(
          { ...sin, limite_monto_mes: "500.00" },
          consumo,
          100.01,
        ),
      ForbiddenException,
      "Límite mensual de la cuenta superado",
    );
  });

  it("si se pasan el día y el mes a la vez, gana el día", () => {
    esperarError(
      () =>
        validarLimitesCliente(
          { ...sin, limite_monto_dia: "500.00", limite_monto_mes: "500.00" },
          consumo,
          200,
        ),
      ForbiddenException,
      "Límite diario de la cuenta superado",
    );
  });

  it("el consumo puede llegar como número", () => {
    expect(() =>
      validarLimitesCliente(
        { ...sin, limite_monto_dia: "500.00" },
        { monto_dia: 0, monto_semana: 0, monto_mes: 0 },
        500,
      ),
    ).not.toThrow();
  });
});

describe("validarLimitesTransaccion", () => {
  const sin = {
    limite_monto_transaccion: null,
    limite_volumen_transaccion: null,
  };

  it("sin vehículo no hay límite que medir", () => {
    expect(() => validarLimitesTransaccion(null, 9999, 9999)).not.toThrow();
  });

  it("el monto justo en el límite pasa", () => {
    expect(() =>
      validarLimitesTransaccion(
        { ...sin, limite_monto_transaccion: "200.00" },
        200,
        1,
      ),
    ).not.toThrow();
  });

  it("pasarse del monto por transacción es 403", () => {
    esperarError(
      () =>
        validarLimitesTransaccion(
          { ...sin, limite_monto_transaccion: "200.00" },
          200.5,
          1,
        ),
      ForbiddenException,
      "Monto por transacción supera el límite (Q200.00)",
    );
  });

  it("pasarse del volumen por transacción es 403", () => {
    esperarError(
      () =>
        validarLimitesTransaccion(
          { ...sin, limite_volumen_transaccion: "10.5" },
          1,
          11,
        ),
      ForbiddenException,
      "Volumen por transacción supera el límite (10.50 gal)",
    );
  });

  it("si se exceden los dos, gana el monto", () => {
    esperarError(
      () =>
        validarLimitesTransaccion(
          {
            limite_monto_transaccion: "200.00",
            limite_volumen_transaccion: "10.5",
          },
          300,
          20,
        ),
      ForbiddenException,
      "Monto por transacción supera el límite (Q200.00)",
    );
  });
});
