// src/modules/despachos/despachos.reglas.spec.ts
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { esperarError } from "../../../test/unit/esperar-error";
import {
  aNumero,
  claveFirma,
  decodificarFirmaPng,
  DIAS_GT,
  diaYMinutoGuatemala,
  exigirOperarioDeLaGasolinera,
  exigirPrecio,
  exigirSistemaActivo,
  estadoHorario,
  exigirVehiculoHabilitado,
  necesitaAgregadoCliente,
  necesitaAgregadoVehiculo,
  normalizarRenglones,
  resumenRenglones,
  totalesDespacho,
  validarHorarioVehiculo,
  validarKilometraje,
  validarLimitesAcumuladosVehiculo,
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

  describe("ventana que cruza la medianoche (22:00–06:00)", () => {
    // 2026-10-07 es miércoles; las horas son de reloj en Guatemala (UTC−6).
    const gtNoche = (hhmm: string) => new Date(`2026-10-07T${hhmm}:00-06:00`);

    it.each(["23:00", "05:00", "22:00", "06:00", "00:00"])(
      "a las %s GT deja pasar",
      (hhmm) => {
        expect(() =>
          validarHorarioVehiculo(ventana("22:00", "06:00"), gtNoche(hhmm)),
        ).not.toThrow();
      },
    );

    it.each(["12:00", "21:59", "06:01"])("a las %s GT rechaza", (hhmm) => {
      esperarError(
        () => validarHorarioVehiculo(ventana("22:00", "06:00"), gtNoche(hhmm)),
        ForbiddenException,
        "Despacho fuera del horario autorizado (22:00–06:00)",
      );
    });
  });
});

describe("estadoHorario", () => {
  const ventana = (hora_inicio: string | null, hora_fin: string | null) => ({
    dias_permitidos: null,
    hora_inicio,
    hora_fin,
  });
  // Instante UTC que corresponde a esa hora de reloj en Guatemala (UTC−6).
  // 2026-09-30 es miércoles.
  const gt = (hhmm: string) => new Date(`2026-09-30T${hhmm}:00-06:00`);

  it("sin ventana siempre está dentro y no hay minutos restantes", () => {
    expect(estadoHorario(ventana(null, null), gt("08:00"))).toEqual({
      dentro_de_horario: true,
      minutos_restantes: 0,
    });
  });

  it("dentro de la ventana cuenta los minutos que faltan para el cierre", () => {
    expect(estadoHorario(ventana("06:00", "18:00"), gt("08:00"))).toEqual({
      dentro_de_horario: true,
      minutos_restantes: 600,
    });
  });

  it("a la hora exacta de cierre sigue dentro, con cero minutos", () => {
    expect(estadoHorario(ventana("06:00", "18:00"), gt("18:00"))).toEqual({
      dentro_de_horario: true,
      minutos_restantes: 0,
    });
  });

  it("pasado el cierre está fuera y no queda tiempo", () => {
    expect(estadoHorario(ventana("06:00", "18:00"), gt("18:30"))).toEqual({
      dentro_de_horario: false,
      minutos_restantes: 0,
    });
  });

  it("sólo con hora_fin cuenta como dentro y calcula hasta el cierre (se fija como está hoy)", () => {
    expect(estadoHorario(ventana(null, "18:00"), gt("08:00"))).toEqual({
      dentro_de_horario: true,
      minutos_restantes: 600,
    });
  });

  it("en un día no permitido está fuera y no queda tiempo, aunque la hora sea válida", () => {
    expect(
      estadoHorario(
        { ...ventana("06:00", "18:00"), dias_permitidos: ["jueves"] },
        gt("08:00"),
      ),
    ).toEqual({ dentro_de_horario: false, minutos_restantes: 0 });
  });

  it("en un día no permitido está fuera aunque no haya ventana horaria", () => {
    expect(
      estadoHorario(
        { ...ventana(null, null), dias_permitidos: ["jueves"] },
        gt("08:00"),
      ),
    ).toEqual({ dentro_de_horario: false, minutos_restantes: 0 });
  });

  it("en un día permitido se comporta como sin restricción de días", () => {
    expect(
      estadoHorario(
        { ...ventana("06:00", "18:00"), dias_permitidos: ["miercoles"] },
        gt("08:00"),
      ),
    ).toEqual({ dentro_de_horario: true, minutos_restantes: 600 });
  });

  describe("ventana que cruza la medianoche (22:00–06:00)", () => {
    const noche = ventana("22:00", "06:00");

    it("antes de medianoche está dentro y cuenta hasta las 06:00 del día siguiente", () => {
      expect(estadoHorario(noche, gt("23:00"))).toEqual({
        dentro_de_horario: true,
        minutos_restantes: 420,
      });
    });

    it("después de medianoche está dentro y cuenta hasta las 06:00", () => {
      expect(estadoHorario(noche, gt("05:00"))).toEqual({
        dentro_de_horario: true,
        minutos_restantes: 60,
      });
    });

    it("a las 22:00 exactas ya está dentro", () => {
      expect(estadoHorario(noche, gt("22:00"))).toEqual({
        dentro_de_horario: true,
        minutos_restantes: 480,
      });
    });

    it("a las 06:00 exactas sigue dentro, con cero minutos", () => {
      expect(estadoHorario(noche, gt("06:00"))).toEqual({
        dentro_de_horario: true,
        minutos_restantes: 0,
      });
    });

    it("si el día siguiente no está permitido, el tiempo restante termina a las 23:59", () => {
      // gt() es miércoles; permitido solo el miércoles: jueves 00:00 no vale.
      const soloMiercoles = { ...noche, dias_permitidos: ["miercoles"] };
      expect(estadoHorario(soloMiercoles, gt("23:00"))).toEqual({
        dentro_de_horario: true,
        minutos_restantes: 59,
      });
    });

    it("si el día siguiente sí está permitido, cuenta hasta el cierre", () => {
      const miJue = { ...noche, dias_permitidos: ["miercoles", "jueves"] };
      expect(estadoHorario(miJue, gt("23:00"))).toEqual({
        dentro_de_horario: true,
        minutos_restantes: 420,
      });
    });

    it("después de medianoche (el día ya es el permitido) cuenta hasta el cierre", () => {
      const soloMiercoles = { ...noche, dias_permitidos: ["miercoles"] };
      expect(estadoHorario(soloMiercoles, gt("05:00"))).toEqual({
        dentro_de_horario: true,
        minutos_restantes: 60,
      });
    });

    it("de día está fuera y no queda tiempo", () => {
      expect(estadoHorario(noche, gt("12:00"))).toEqual({
        dentro_de_horario: false,
        minutos_restantes: 0,
      });
    });
  });

  it("una lista vacía de días no restringe", () => {
    expect(
      estadoHorario(
        { ...ventana("06:00", "18:00"), dias_permitidos: [] },
        gt("08:00"),
      ),
    ).toEqual({ dentro_de_horario: true, minutos_restantes: 600 });
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
    expect(valorizarRenglon("100", "25", "diesel")).toEqual({
      monto: 100,
      galones: 4,
    });
  });

  it.each(["0", "-5", "abc"])("rechaza el monto %p", (monto) => {
    esperarError(
      () => valorizarRenglon(monto, "25", "diesel"),
      BadRequestException,
      "El monto de cada renglón debe ser mayor a cero",
    );
  });

  it.each(["0", "0.000", "-1", "abc"])(
    "rechaza el precio registrado %p con el combustible en el mensaje",
    (precio) => {
      esperarError(
        () => valorizarRenglon("100", precio, "super"),
        BadRequestException,
        "El precio registrado para super no es válido",
      );
    },
  );

  it("con monto y precio inválidos gana el error del monto (el del operario)", () => {
    esperarError(
      () => valorizarRenglon("0", "0", "diesel"),
      BadRequestException,
      "El monto de cada renglón debe ser mayor a cero",
    );
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

describe("necesitaAgregadoVehiculo", () => {
  const campos = [
    "limite_monto_dia",
    "limite_monto_semana",
    "limite_monto_mes",
    "limite_volumen_dia",
    "limite_volumen_semana",
    "limite_volumen_mes",
    "limite_trans_dia",
    "limite_trans_semana",
    "limite_trans_mes",
  ] as const;
  const sinLimites = {
    limite_monto_dia: null,
    limite_monto_semana: null,
    limite_monto_mes: null,
    limite_volumen_dia: null,
    limite_volumen_semana: null,
    limite_volumen_mes: null,
    limite_trans_dia: null,
    limite_trans_semana: null,
    limite_trans_mes: null,
  };

  it("sin vehículo no hace falta consultar", () => {
    expect(necesitaAgregadoVehiculo(null)).toBe(false);
  });

  it("con los nueve límites en null no hace falta consultar", () => {
    expect(necesitaAgregadoVehiculo(sinLimites)).toBe(false);
  });

  it.each(campos)("basta con %s para necesitar el agregado", (campo) => {
    const valor = campo.startsWith("limite_trans") ? 5 : "100.00";
    expect(necesitaAgregadoVehiculo({ ...sinLimites, [campo]: valor })).toBe(
      true,
    );
  });
});

describe("validarLimitesAcumuladosVehiculo", () => {
  const sinLimites = {
    limite_monto_dia: null,
    limite_monto_semana: null,
    limite_monto_mes: null,
    limite_volumen_dia: null,
    limite_volumen_semana: null,
    limite_volumen_mes: null,
    limite_trans_dia: null,
    limite_trans_semana: null,
    limite_trans_mes: null,
  };
  const cero = {
    monto_dia: "0",
    monto_semana: "0",
    monto_mes: "0",
    vol_dia: "0",
    vol_semana: "0",
    vol_mes: "0",
    trans_dia: "0",
    trans_semana: "0",
    trans_mes: "0",
  };

  it("monto diario: lo consumido más el monto cabe en el límite", () => {
    expect(() =>
      validarLimitesAcumuladosVehiculo(
        { ...sinLimites, limite_monto_dia: "1000.00" },
        { ...cero, monto_dia: "950" },
        50,
        0,
      ),
    ).not.toThrow();
  });

  it("monto diario: pasarse es 403 con consumido y límite", () => {
    esperarError(
      () =>
        validarLimitesAcumuladosVehiculo(
          { ...sinLimites, limite_monto_dia: "1000.00" },
          { ...cero, monto_dia: "950" },
          60,
          0,
        ),
      ForbiddenException,
      "Límite diario de monto superado. Consumido: 950.00 — Límite: 1000.00",
    );
  });

  it("monto semanal y mensual llevan su palabra", () => {
    esperarError(
      () =>
        validarLimitesAcumuladosVehiculo(
          { ...sinLimites, limite_monto_semana: "100" },
          { ...cero, monto_semana: "90" },
          20,
          0,
        ),
      ForbiddenException,
      "Límite semanal de monto superado. Consumido: 90.00 — Límite: 100.00",
    );
    esperarError(
      () =>
        validarLimitesAcumuladosVehiculo(
          { ...sinLimites, limite_monto_mes: "100" },
          { ...cero, monto_mes: "90" },
          20,
          0,
        ),
      ForbiddenException,
      "Límite mensual de monto superado. Consumido: 90.00 — Límite: 100.00",
    );
  });

  it("volumen mensual: pasarse es 403", () => {
    esperarError(
      () =>
        validarLimitesAcumuladosVehiculo(
          { ...sinLimites, limite_volumen_mes: "100" },
          { ...cero, vol_mes: "99.5" },
          0,
          0.6,
        ),
      ForbiddenException,
      "Límite mensual de volumen superado. Consumido: 99.50 — Límite: 100.00",
    );
  });

  it("volumen diario y semanal llevan su palabra", () => {
    esperarError(
      () =>
        validarLimitesAcumuladosVehiculo(
          { ...sinLimites, limite_volumen_dia: "10" },
          { ...cero, vol_dia: "9" },
          0,
          2,
        ),
      ForbiddenException,
      "Límite diario de volumen superado. Consumido: 9.00 — Límite: 10.00",
    );
    esperarError(
      () =>
        validarLimitesAcumuladosVehiculo(
          { ...sinLimites, limite_volumen_semana: "10" },
          { ...cero, vol_semana: "9" },
          0,
          2,
        ),
      ForbiddenException,
      "Límite semanal de volumen superado. Consumido: 9.00 — Límite: 10.00",
    );
  });

  it("transacciones diarias: con 2 de 3 pasa, con 3 de 3 es 403", () => {
    const v = { ...sinLimites, limite_trans_dia: 3 };
    expect(() =>
      validarLimitesAcumuladosVehiculo(v, { ...cero, trans_dia: "2" }, 0, 0),
    ).not.toThrow();
    esperarError(
      () =>
        validarLimitesAcumuladosVehiculo(v, { ...cero, trans_dia: "3" }, 0, 0),
      ForbiddenException,
      "Límite diario de transacciones alcanzado (3)",
    );
  });

  it("transacciones semanales y mensuales llevan su palabra", () => {
    esperarError(
      () =>
        validarLimitesAcumuladosVehiculo(
          { ...sinLimites, limite_trans_semana: 5 },
          { ...cero, trans_semana: "5" },
          0,
          0,
        ),
      ForbiddenException,
      "Límite semanal de transacciones alcanzado (5)",
    );
    esperarError(
      () =>
        validarLimitesAcumuladosVehiculo(
          { ...sinLimites, limite_trans_mes: 20 },
          { ...cero, trans_mes: "20" },
          0,
          0,
        ),
      ForbiddenException,
      "Límite mensual de transacciones alcanzado (20)",
    );
  });

  it("un límite de transacciones en 0 es un límite válido: siempre 403", () => {
    esperarError(
      () =>
        validarLimitesAcumuladosVehiculo(
          { ...sinLimites, limite_trans_dia: 0 },
          cero,
          0,
          0,
        ),
      ForbiddenException,
      "Límite diario de transacciones alcanzado (0)",
    );
  });

  it("sin límites no objeta nada", () => {
    expect(() =>
      validarLimitesAcumuladosVehiculo(sinLimites, cero, 1e9, 1e9),
    ).not.toThrow();
  });

  it("evalúa montos, luego volúmenes, luego transacciones", () => {
    const todos = {
      limite_monto_dia: "1",
      limite_monto_semana: null,
      limite_monto_mes: null,
      limite_volumen_dia: "1",
      limite_volumen_semana: null,
      limite_volumen_mes: null,
      limite_trans_dia: 0,
      limite_trans_semana: null,
      limite_trans_mes: null,
    };
    esperarError(
      () => validarLimitesAcumuladosVehiculo(todos, cero, 5, 5),
      ForbiddenException,
      "Límite diario de monto superado. Consumido: 0.00 — Límite: 1.00",
    );
    esperarError(
      () =>
        validarLimitesAcumuladosVehiculo(
          { ...todos, limite_monto_dia: null },
          cero,
          5,
          5,
        ),
      ForbiddenException,
      "Límite diario de volumen superado. Consumido: 0.00 — Límite: 1.00",
    );
    esperarError(
      () =>
        validarLimitesAcumuladosVehiculo(
          { ...todos, limite_monto_dia: null, limite_volumen_dia: null },
          cero,
          5,
          5,
        ),
      ForbiddenException,
      "Límite diario de transacciones alcanzado (0)",
    );
  });
});

describe("validarKilometraje", () => {
  it("sin máximo previo pasa", () => {
    expect(() => validarKilometraje("100", null)).not.toThrow();
    expect(() => validarKilometraje("100", undefined)).not.toThrow();
  });

  it("un kilometraje mayor al máximo pasa", () => {
    expect(() => validarKilometraje("15000", "14999.5")).not.toThrow();
  });

  it("igual o menor al máximo es 403", () => {
    esperarError(
      () => validarKilometraje("15000", "15000"),
      ForbiddenException,
      "Inconsistencia de kilometraje detectada",
    );
    esperarError(
      () => validarKilometraje("14000", "15000"),
      ForbiddenException,
      "Inconsistencia de kilometraje detectada",
    );
  });

  it("acepta el máximo previo como número", () => {
    expect(() => validarKilometraje("15000", 14999.5)).not.toThrow();
    esperarError(
      () => validarKilometraje("15000", 15000),
      ForbiddenException,
      "Inconsistencia de kilometraje detectada",
    );
  });
});

describe("decodificarFirmaPng", () => {
  const MAGIA = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const png = Buffer.from([...MAGIA, 1, 2, 3, 4]);

  it("devuelve los bytes de un PNG sin prefijo", () => {
    expect(decodificarFirmaPng(png.toString("base64")).equals(png)).toBe(true);
  });

  it("quita el prefijo data:image/png;base64, y devuelve los bytes", () => {
    const entrada = `data:image/png;base64,${png.toString("base64")}`;
    expect(decodificarFirmaPng(entrada).equals(png)).toBe(true);
  });

  it("rechaza bytes de JPEG", () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0]);
    esperarError(
      () => decodificarFirmaPng(jpeg.toString("base64")),
      BadRequestException,
      "La firma debe ser un PNG válido",
    );
  });

  it("rechaza un valor demasiado corto para tener la firma mágica", () => {
    esperarError(
      () => decodificarFirmaPng("iVBORw=="),
      BadRequestException,
      "La firma debe ser un PNG válido",
    );
    esperarError(
      () => decodificarFirmaPng(""),
      BadRequestException,
      "La firma debe ser un PNG válido",
    );
  });

  it("no confía en el prefijo: data:image/jpeg delante de bytes PNG se rechaza", () => {
    const entrada = `data:image/jpeg;base64,${png.toString("base64")}`;
    esperarError(
      () => decodificarFirmaPng(entrada),
      BadRequestException,
      "La firma debe ser un PNG válido",
    );
  });

  it("responde 'Firma inválida' si la decodificación lanza", () => {
    // Un objeto cuyo replace no devuelve texto hace que Buffer.from lance.
    const raro = { replace: () => 123 } as unknown as string;
    esperarError(
      () => decodificarFirmaPng(raro),
      BadRequestException,
      "Firma inválida",
    );
  });
});

describe("claveFirma", () => {
  it("arma la llave con año y mes de Guatemala", () => {
    // 03:00Z del 1 de noviembre: en Guatemala todavía es 31 de octubre.
    expect(claveFirma("gas-1", new Date("2026-11-01T03:00:00Z"), "abc")).toBe(
      "firmas/gas-1/2026/10/abc.png",
    );
  });
});
