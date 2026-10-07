// src/modules/despachos/despachos.reglas.ts
// Reglas puras de la creación de despachos: reciben datos ya leídos, no tocan
// la base ni el reloj. Las consultas y la transacción siguen en el servicio.
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { ahoraGuatemala, aMinutos } from "../../common/hora-guatemala";
import type { clientes, Renglon, vehiculos } from "../../db/schema";

type ClienteRow = typeof clientes.$inferSelect;
type VehiculoRow = typeof vehiculos.$inferSelect;

export interface LineaDespacho {
  renglon: Renglon;
  tipo_combustible: string;
  monto: string;
}

// ── Bloqueos ───────────────────────────────────────────────────────────

export function exigirSistemaActivo(
  sys: { sistema_bloqueado: boolean } | undefined,
): void {
  if (sys?.sistema_bloqueado) {
    throw new ForbiddenException(
      "Sistema suspendido — contacte al administrador",
    );
  }
}

// La FK sólo garantiza que el operario existe. Sin esto un supervisor podía
// cargar el vale a un operario de la otra estación o a uno dado de baja.
export function exigirOperarioDeLaGasolinera<T>(
  operario: T | undefined,
): asserts operario is T {
  if (!operario) {
    throw new BadRequestException(
      "El operario no pertenece a esta gasolinera o está inactivo.",
    );
  }
}

// ── Renglones ──────────────────────────────────────────────────────────

/**
 * Lleva las dos formas del DTO a una sola lista de renglones.
 *
 * La forma vieja (`tipo_combustible` + `monto` en la raíz) se mantiene por
 * compatibilidad: el frontend se despliega aparte y no puede cambiar en el
 * mismo instante que el backend. Equivale a un único renglón `vehiculo`.
 */
export function normalizarRenglones(dto: {
  tipo_combustible?: string | null;
  monto?: string | null;
  detalles?: LineaDespacho[] | null;
}): LineaDespacho[] {
  const tieneForma1 = dto.tipo_combustible != null || dto.monto != null;
  const tieneForma2 = dto.detalles != null && dto.detalles.length > 0;

  if (tieneForma1 && tieneForma2) {
    throw new BadRequestException(
      "Mandá `detalles` o `tipo_combustible`+`monto`, no las dos formas",
    );
  }
  if (tieneForma2) {
    return dto.detalles!.map((d) => ({
      renglon: d.renglon,
      tipo_combustible: d.tipo_combustible,
      monto: d.monto,
    }));
  }
  if (dto.tipo_combustible == null || dto.monto == null) {
    throw new BadRequestException(
      "Falta el detalle del despacho: mandá `detalles`, o `tipo_combustible` y `monto`",
    );
  }
  return [
    {
      renglon: "vehiculo",
      tipo_combustible: dto.tipo_combustible,
      monto: dto.monto,
    },
  ];
}

export function validarParVehiculoPiloto(
  dto: { vehiculo_id?: string | null; piloto_id?: string | null },
  lineas: LineaDespacho[],
): void {
  const hayRenglonVehiculo = lineas.some((l) => l.renglon === "vehiculo");

  // Vehículo y piloto van juntos: un renglón a vehículo sin piloto deja el
  // vale sin a quién atribuirle el combustible.
  if (Boolean(dto.vehiculo_id) !== Boolean(dto.piloto_id)) {
    throw new BadRequestException(
      "Vehículo y piloto deben venir juntos o ninguno de los dos",
    );
  }
  if (hayRenglonVehiculo && !dto.vehiculo_id) {
    throw new BadRequestException(
      "El renglón de vehículo requiere vehiculo_id y piloto_id",
    );
  }
  if (!hayRenglonVehiculo && dto.vehiculo_id) {
    throw new BadRequestException(
      "Se indicó vehículo pero ningún renglón le despacha combustible",
    );
  }
}

/** Texto del movimiento de saldo: "diesel 80.000 gal + caneca super 5.000 gal". */
export function resumenRenglones(
  renglones: { renglon: string; tipo_combustible: string; galones: number }[],
): string {
  return renglones
    .map((r) => {
      const etiqueta = r.renglon === "vehiculo" ? "" : `${r.renglon} `;
      return `${etiqueta}${r.tipo_combustible} ${r.galones.toFixed(3)} gal`;
    })
    .join(" + ");
}

// ── Vehículo, productos, días y horario ────────────────────────────────

/** Nombres de día en el orden de `Date.getUTCDay()`: domingo = 0. */
export const DIAS_GT = [
  "domingo",
  "lunes",
  "martes",
  "miercoles",
  "jueves",
  "viernes",
  "sabado",
];

/** Día y minuto del día en Guatemala para un instante UTC. */
export function diaYMinutoGuatemala(ahora: Date): {
  dia: string;
  minutos: number;
} {
  const { diaSemana, minutos } = ahoraGuatemala(ahora);
  return { dia: DIAS_GT[diaSemana], minutos };
}

export function exigirVehiculoHabilitado<T extends { bloqueado: boolean }>(
  v: T | undefined,
): asserts v is T {
  if (!v) throw new NotFoundException("Vehículo no encontrado");

  if (v.bloqueado) {
    throw new ForbiddenException(
      "Vehículo bloqueado — consulte con su administrador",
    );
  }
}

// Los productos permitidos son del vehículo, así que sólo restringen el
// renglón que le despacha a él: en una caneca puede ir otro combustible.
export function validarProductosPermitidos(
  v: { productos_permitidos: string[] | null },
  lineas: LineaDespacho[],
): void {
  if (v.productos_permitidos && v.productos_permitidos.length > 0) {
    for (const l of lineas) {
      if (
        l.renglon === "vehiculo" &&
        !v.productos_permitidos.includes(l.tipo_combustible)
      ) {
        throw new ForbiddenException(
          `Este vehículo no puede cargar ${l.tipo_combustible}`,
        );
      }
    }
  }
}

export function validarHorarioVehiculo(
  v: {
    dias_permitidos: string[] | null;
    hora_inicio: string | null;
    hora_fin: string | null;
  } | null,
  ahora: Date,
): void {
  const { dia, minutos } = diaYMinutoGuatemala(ahora);

  if (v?.dias_permitidos && v.dias_permitidos.length > 0) {
    if (!v.dias_permitidos.includes(dia)) {
      throw new ForbiddenException(
        `Despacho no permitido hoy (${dia}) para este vehículo`,
      );
    }
  }

  if (v?.hora_inicio && v.hora_fin) {
    const inicio = aMinutos(v.hora_inicio);
    const fin = aMinutos(v.hora_fin);
    if (minutos < inicio || minutos > fin) {
      throw new ForbiddenException(
        `Despacho fuera del horario autorizado (${v.hora_inicio}–${v.hora_fin})`,
      );
    }
  }
}

// ── Precio y totales ───────────────────────────────────────────────────

export function exigirPrecio<T>(
  precio: T | undefined,
  tipoCombustible: string,
): asserts precio is T {
  if (!precio) {
    throw new BadRequestException(
      `No hay precio registrado para ${tipoCombustible} hoy en esta gasolinera`,
    );
  }
}

// El operario teclea el monto en quetzales; los galones se derivan del
// precio autoritativo del servidor. Así el total del vale es exactamente
// lo que paga el cliente, sin desajustes de redondeo.
export function valorizarRenglon(
  monto: string,
  precioGalon: string,
): { monto: number; galones: number } {
  const montoNum = parseFloat(monto);
  if (!(montoNum > 0)) {
    throw new BadRequestException(
      "El monto de cada renglón debe ser mayor a cero",
    );
  }
  return { monto: montoNum, galones: montoNum / parseFloat(precioGalon) };
}

export function totalesDespacho(
  renglones: { renglon: Renglon; monto: number; galones: number }[],
): {
  montoEstimado: number;
  galonesEstimado: number;
  montoTotal: string;
  montoVehiculo: number;
  galonesVehiculo: number;
} {
  const sumaMonto = (rs: typeof renglones) =>
    rs.reduce((acc, r) => acc + r.monto, 0);
  const sumaGalones = (rs: typeof renglones) =>
    rs.reduce((acc, r) => acc + r.galones, 0);

  const montoEstimado = sumaMonto(renglones);
  const galonesEstimado = sumaGalones(renglones);

  // Los límites del vehículo miran SÓLO sus renglones: cobrarle al vehículo
  // el combustible que se fue en canecas sobrecontaría su cupo.
  const renglonesVehiculo = renglones.filter((r) => r.renglon === "vehiculo");

  return {
    montoEstimado,
    galonesEstimado,
    montoTotal: montoEstimado.toFixed(3),
    montoVehiculo: sumaMonto(renglonesVehiculo),
    galonesVehiculo: sumaGalones(renglonesVehiculo),
  };
}

// ── Límites ────────────────────────────────────────────────────────────

// Lo que devuelven de verdad los `sql<number>`: node-postgres entrega los
// numéricos como string, aunque el genérico diga number.
export type Agregado = number | string;

// `unknown` a propósito: llega un numérico de Drizzle (string) o un número.
export const aNumero = (x: unknown): number | null =>
  // eslint-disable-next-line @typescript-eslint/no-base-to-string
  x != null ? parseFloat(String(x)) : null;

type LimitesCuenta = Pick<
  ClienteRow,
  "limite_monto_dia" | "limite_monto_semana" | "limite_monto_mes"
>;

export function necesitaAgregadoCliente(c: LimitesCuenta): boolean {
  return (
    c.limite_monto_dia != null ||
    c.limite_monto_semana != null ||
    c.limite_monto_mes != null
  );
}

export function validarLimitesCliente(
  c: LimitesCuenta,
  consumo: { monto_dia: Agregado; monto_semana: Agregado; monto_mes: Agregado },
  montoEstimado: number,
): void {
  const clienteChecks: Array<[number | null, number, string]> = [
    [
      aNumero(c.limite_monto_dia),
      parseFloat(String(consumo.monto_dia)),
      "Límite diario de la cuenta superado",
    ],
    [
      aNumero(c.limite_monto_semana),
      parseFloat(String(consumo.monto_semana)),
      "Límite semanal de la cuenta superado",
    ],
    [
      aNumero(c.limite_monto_mes),
      parseFloat(String(consumo.monto_mes)),
      "Límite mensual de la cuenta superado",
    ],
  ];
  for (const [limite, consumido, msg] of clienteChecks) {
    if (limite != null && consumido + montoEstimado > limite) {
      throw new ForbiddenException(msg);
    }
  }
}

// Miden el renglón del vehículo, no el total del vale.
export function validarLimitesTransaccion(
  v: Pick<
    VehiculoRow,
    "limite_monto_transaccion" | "limite_volumen_transaccion"
  > | null,
  montoVehiculo: number,
  galonesVehiculo: number,
): void {
  const lmt = aNumero(v?.limite_monto_transaccion);
  if (lmt != null && montoVehiculo > lmt)
    throw new ForbiddenException(
      `Monto por transacción supera el límite (Q${lmt.toFixed(2)})`,
    );
  const lvt = aNumero(v?.limite_volumen_transaccion);
  if (lvt != null && galonesVehiculo > lvt)
    throw new ForbiddenException(
      `Volumen por transacción supera el límite (${lvt.toFixed(2)} gal)`,
    );
}

// ── Límites acumulados del vehículo y kilometraje ──────────────────────

type LimitesAcumulados = Pick<
  VehiculoRow,
  | "limite_monto_dia"
  | "limite_monto_semana"
  | "limite_monto_mes"
  | "limite_volumen_dia"
  | "limite_volumen_semana"
  | "limite_volumen_mes"
  | "limite_trans_dia"
  | "limite_trans_semana"
  | "limite_trans_mes"
>;

export function necesitaAgregadoVehiculo(v: LimitesAcumulados | null): boolean {
  return (
    v != null &&
    (v.limite_monto_dia != null ||
      v.limite_monto_semana != null ||
      v.limite_monto_mes != null ||
      v.limite_volumen_dia != null ||
      v.limite_volumen_semana != null ||
      v.limite_volumen_mes != null ||
      v.limite_trans_dia != null ||
      v.limite_trans_semana != null ||
      v.limite_trans_mes != null)
  );
}

export function validarLimitesAcumuladosVehiculo(
  v: LimitesAcumulados,
  agg: {
    monto_dia: Agregado;
    monto_semana: Agregado;
    monto_mes: Agregado;
    vol_dia: Agregado;
    vol_semana: Agregado;
    vol_mes: Agregado;
    trans_dia: Agregado;
    trans_semana: Agregado;
    trans_mes: Agregado;
  },
  montoVehiculo: number,
  galonesVehiculo: number,
): void {
  const checks: Array<[number | null, number, number, string]> = [
    [
      aNumero(v.limite_monto_dia),
      parseFloat(String(agg.monto_dia)),
      montoVehiculo,
      `Límite diario de monto superado`,
    ],
    [
      aNumero(v.limite_monto_semana),
      parseFloat(String(agg.monto_semana)),
      montoVehiculo,
      `Límite semanal de monto superado`,
    ],
    [
      aNumero(v.limite_monto_mes),
      parseFloat(String(agg.monto_mes)),
      montoVehiculo,
      `Límite mensual de monto superado`,
    ],
    [
      aNumero(v.limite_volumen_dia),
      parseFloat(String(agg.vol_dia)),
      galonesVehiculo,
      `Límite diario de volumen superado`,
    ],
    [
      aNumero(v.limite_volumen_semana),
      parseFloat(String(agg.vol_semana)),
      galonesVehiculo,
      `Límite semanal de volumen superado`,
    ],
    [
      aNumero(v.limite_volumen_mes),
      parseFloat(String(agg.vol_mes)),
      galonesVehiculo,
      `Límite mensual de volumen superado`,
    ],
  ];
  for (const [limite, consumido, delta, msg] of checks) {
    if (limite != null && consumido + delta > limite) {
      throw new ForbiddenException(
        `${msg}. Consumido: ${consumido.toFixed(2)} — Límite: ${limite.toFixed(2)}`,
      );
    }
  }
  const transChecks: Array<[number | null, number, string]> = [
    [v.limite_trans_dia, parseInt(String(agg.trans_dia)), "diario"],
    [v.limite_trans_semana, parseInt(String(agg.trans_semana)), "semanal"],
    [v.limite_trans_mes, parseInt(String(agg.trans_mes)), "mensual"],
  ];
  for (const [limite, consumido, periodo] of transChecks) {
    if (limite != null && consumido + 1 > limite) {
      throw new ForbiddenException(
        `Límite ${periodo} de transacciones alcanzado (${limite})`,
      );
    }
  }
}

export function validarKilometraje(
  kilometraje: string,
  maxKm: Agregado | null | undefined,
): void {
  const max = aNumero(maxKm);
  if (max !== null && parseFloat(kilometraje) <= max) {
    throw new ForbiddenException("Inconsistencia de kilometraje detectada");
  }
}

// ── Firma ──────────────────────────────────────────────────────────────

export function decodificarFirmaPng(firmaBase64: string): Buffer {
  // No se confía en el prefijo data:image/png: se decodifica y se verifica la
  // firma mágica del PNG (89 50 4E 47 0D 0A 1A 0A) sobre los bytes reales.
  const base64 = firmaBase64.replace(/^data:image\/png;base64,/, "");
  let bytes: Buffer;
  try {
    bytes = Buffer.from(base64, "base64");
  } catch {
    throw new BadRequestException("Firma inválida");
  }
  const PNG_MAGIC = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);
  if (bytes.length < 8 || !bytes.subarray(0, 8).equals(PNG_MAGIC)) {
    throw new BadRequestException("La firma debe ser un PNG válido");
  }
  return bytes;
}

// Key con fecha (hora de Guatemala) para poder barrer huérfanos por antigüedad.
export function claveFirma(
  gasolineraId: string,
  ahora: Date,
  id: string,
): string {
  const [yyyy, mm] = ahoraGuatemala(ahora).fecha.split("-");
  return `firmas/${gasolineraId}/${yyyy}/${mm}/${id}.png`;
}
