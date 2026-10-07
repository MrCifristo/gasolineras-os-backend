// src/modules/despachos/despachos.reglas.spec.ts
import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { esperarError } from "../../../test/unit/esperar-error";
import {
  exigirOperarioDeLaGasolinera,
  exigirSistemaActivo,
  normalizarRenglones,
  resumenRenglones,
  validarParVehiculoPiloto,
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
