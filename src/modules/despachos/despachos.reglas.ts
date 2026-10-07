// src/modules/despachos/despachos.reglas.ts
// Reglas puras de la creación de despachos: reciben datos ya leídos, no tocan
// la base ni el reloj. Las consultas y la transacción siguen en el servicio.
import { BadRequestException, ForbiddenException } from "@nestjs/common";
import type { Renglon } from "../../db/schema";

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
