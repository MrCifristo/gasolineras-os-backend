// src/modules/saldos/saldos.reglas.ts
// Reglas puras de saldos: sin base de datos ni reloj.
import { BadRequestException } from "@nestjs/common";

export function validarMontoAbono(monto: string): void {
  if (!(Number(monto) > 0)) {
    throw new BadRequestException("El monto debe ser mayor a cero");
  }
}

export function validarCuadre(dto: {
  tipo: string;
  cliente_id?: string | null;
}): void {
  if (dto.tipo === "cliente" && !dto.cliente_id) {
    throw new BadRequestException(
      'cliente_id es requerido cuando tipo es "cliente"',
    );
  }
}

/**
 * Totales del estado de cuenta. La identidad que debe cumplirse siempre es
 * `saldo_inicial + abonos − débitos = saldo_final`.
 */
export function resumenEstadoCuenta(
  saldoPrevio: string | null | undefined,
  movimientos: { tipo: string; monto: string }[],
): {
  saldo_inicial: string;
  total_abonos: string;
  total_debitos: string;
  saldo_final: string;
} {
  const suma = (tipo: string) =>
    movimientos
      .filter((m) => m.tipo === tipo)
      .reduce((acc, m) => acc + parseFloat(m.monto), 0);

  const saldoInicial = parseFloat(saldoPrevio ?? "0");
  const abonos = suma("credito");
  const debitos = suma("debito");

  return {
    saldo_inicial: saldoInicial.toFixed(3),
    total_abonos: abonos.toFixed(3),
    total_debitos: debitos.toFixed(3),
    saldo_final: (saldoInicial + abonos - debitos).toFixed(3),
  };
}
