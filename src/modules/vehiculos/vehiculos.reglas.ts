// src/modules/vehiculos/vehiculos.reglas.ts
// Reglas puras de vehículos: coerción de decimales, alcance del cliente y
// plantilla de límites. Las consultas siguen en el servicio.
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import type { clientes } from "../../db/schema";
import type { CreateVehiculoDto } from "./dto/create-vehiculo.dto";

type ClienteRow = typeof clientes.$inferSelect;

export const CAMPOS_DECIMALES = [
  "limite_monto_transaccion",
  "limite_monto_dia",
  "limite_monto_semana",
  "limite_monto_mes",
  "limite_volumen_transaccion",
  "limite_volumen_dia",
  "limite_volumen_semana",
  "limite_volumen_mes",
] as const;

export function coercerDecimales(
  dto: Record<string, any>,
): Record<string, any> {
  const out: Record<string, any> = { ...dto };
  for (const f of CAMPOS_DECIMALES) {
    if (out[f] != null) out[f] = String(out[f]);
  }
  return out;
}

/** PartialType vuelve opcionales (y nulables) todos los campos; bloqueado es NOT NULL. */
export function rechazarBloqueadoNulo(dto: {
  bloqueado?: boolean | null;
}): void {
  if (dto.bloqueado === null)
    throw new BadRequestException("bloqueado debe ser verdadero o falso");
}

/**
 * Alcance fail-closed: el admin no se acota (null); cualquier otro rol queda
 * acotado a su cliente_id y, sin él, no ve nada (404).
 */
export function clienteIdDeAlcance(user: {
  rol: string;
  cliente_id?: string | null;
}): string | null {
  if (user.rol === "admin") return null;
  if (!user.cliente_id) throw new NotFoundException("Vehículo no encontrado");
  return user.cliente_id;
}

/** Un cliente puede bloquear sus vehículos pero no desbloquearlos. */
export function intentaDesbloquear(
  user: { rol: string },
  dto: { bloqueado?: boolean | null },
): boolean {
  return user.rol === "cliente" && dto.bloqueado === false;
}

/**
 * Empresa dueña de un vehículo nuevo. El cliente crea siempre a su nombre (el
 * del token pisa el del body; sin empresa, fail-closed); el admin la elige.
 */
export function clienteIdParaCrear(
  user: { rol: string; cliente_id?: string | null },
  clienteIdDelBody?: string | null,
): string {
  const delAlcance = clienteIdDeAlcance(user);
  if (delAlcance) return delAlcance;
  if (!clienteIdDelBody)
    throw new BadRequestException("cliente_id es obligatorio");
  return clienteIdDelBody;
}

/** Un cliente no puede mover un vehículo a otra empresa. */
export function rechazarOtraEmpresa(
  user: { rol: string; cliente_id?: string | null },
  clienteIdDelBody?: string | null,
): void {
  if (
    user.rol === "cliente" &&
    clienteIdDelBody != null &&
    clienteIdDelBody !== user.cliente_id
  )
    throw new ForbiddenException("No puede asignar el vehículo a otra empresa");
}

export function plantillaDesdeCliente(
  p:
    | Pick<
        ClienteRow,
        | "plantilla_monto_transaccion"
        | "plantilla_monto_dia"
        | "plantilla_monto_semana"
        | "plantilla_monto_mes"
        | "plantilla_volumen_transaccion"
        | "plantilla_volumen_dia"
        | "plantilla_volumen_semana"
        | "plantilla_volumen_mes"
        | "plantilla_trans_dia"
        | "plantilla_trans_semana"
        | "plantilla_trans_mes"
        | "plantilla_productos_permitidos"
      >
    | undefined,
): Partial<CreateVehiculoDto> {
  const plantilla: Partial<CreateVehiculoDto> = {};
  if (!p) return plantilla;
  if (p.plantilla_monto_transaccion != null)
    plantilla.limite_monto_transaccion = parseFloat(
      String(p.plantilla_monto_transaccion),
    );
  if (p.plantilla_monto_dia != null)
    plantilla.limite_monto_dia = parseFloat(String(p.plantilla_monto_dia));
  if (p.plantilla_monto_semana != null)
    plantilla.limite_monto_semana = parseFloat(
      String(p.plantilla_monto_semana),
    );
  if (p.plantilla_monto_mes != null)
    plantilla.limite_monto_mes = parseFloat(String(p.plantilla_monto_mes));
  if (p.plantilla_volumen_transaccion != null)
    plantilla.limite_volumen_transaccion = parseFloat(
      String(p.plantilla_volumen_transaccion),
    );
  if (p.plantilla_volumen_dia != null)
    plantilla.limite_volumen_dia = parseFloat(String(p.plantilla_volumen_dia));
  if (p.plantilla_volumen_semana != null)
    plantilla.limite_volumen_semana = parseFloat(
      String(p.plantilla_volumen_semana),
    );
  if (p.plantilla_volumen_mes != null)
    plantilla.limite_volumen_mes = parseFloat(String(p.plantilla_volumen_mes));
  if (p.plantilla_trans_dia != null)
    plantilla.limite_trans_dia = p.plantilla_trans_dia;
  if (p.plantilla_trans_semana != null)
    plantilla.limite_trans_semana = p.plantilla_trans_semana;
  if (p.plantilla_trans_mes != null)
    plantilla.limite_trans_mes = p.plantilla_trans_mes;
  if (p.plantilla_productos_permitidos?.length)
    plantilla.productos_permitidos = p.plantilla_productos_permitidos;
  return plantilla;
}
