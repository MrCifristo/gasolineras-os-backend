// src/modules/usuarios/usuarios.reglas.ts
// Reglas puras del alta y la edición de usuarios: sin base de datos ni reloj.
import { BadRequestException } from "@nestjs/common";

/**
 * Un usuario cliente sin empresa no tiene alcance: los servicios fallan
 * cerrado con él, pero cualquier ruta que olvide hacerlo le mostraría los
 * datos de todos los clientes. Defensa en profundidad: no puede existir.
 */
export function exigirEmpresaSiEsCliente(
  rol: string | undefined,
  clienteId: string | null | undefined,
): void {
  if (rol === "cliente" && !clienteId) {
    throw new BadRequestException(
      "Un usuario cliente debe tener una empresa (cliente_id) asignada",
    );
  }
}

/**
 * El correo es opcional: un cliente puede tener sólo teléfono. Se exige al
 * menos uno de los dos como identificador de acceso.
 */
export function identificadoresDeAlta(datos: {
  email?: string | null;
  telefono?: string | null;
}): { email: string | null; telefono: string | null } {
  const email = datos.email?.trim().toLowerCase() || null;
  const telefono = datos.telefono?.trim() || null;
  if (!email && !telefono) {
    throw new BadRequestException(
      "Debe indicar un correo o un número de teléfono",
    );
  }
  return { email, telefono };
}

/** `existente` es la fila que devolvió la consulta de unicidad, si la hubo. */
export function exigirNoRegistrado(
  existente: unknown,
  campo: "email" | "teléfono",
): void {
  if (existente) {
    const articulo = campo === "email" ? "El email" : "El teléfono";
    throw new BadRequestException(`${articulo} ya está registrado`);
  }
}

/** Normaliza correo y teléfono (en blanco = null) sin mutar la entrada ni agregar claves. */
export function normalizarCambios<
  T extends { email?: string | null; telefono?: string | null },
>(cambios: T): T {
  const resultado = { ...cambios };
  // Vacío tras recortar es null: "" chocaría con el UNIQUE del segundo alta.
  if (typeof cambios.email === "string")
    resultado.email = cambios.email.trim().toLowerCase() || null;
  if (typeof cambios.telefono === "string")
    resultado.telefono = cambios.telefono.trim() || null;
  return resultado;
}

/**
 * La empresa que quedaría tras la edición. Un `null` explícito cuenta: es
 * quitarle la empresa; sin valor (ausente o undefined), se conserva la actual.
 */
export function clienteIdResultante(
  resto: { cliente_id?: string | null },
  actual: { cliente_id: string | null },
): string | null | undefined {
  // `!== undefined` y no `in`: el ValidationPipe deja `cliente_id` como clave
  // propia con valor undefined cuando el body no lo trae.
  return resto.cliente_id !== undefined ? resto.cliente_id : actual.cliente_id;
}

/**
 * La tabla exige al menos un identificador (CHECK): se valida el estado que
 * quedaría tras la edición, igual que `clienteIdResultante`. Un `null`
 * explícito borra; ausente o undefined conserva el actual.
 */
export function exigirIdentificadorResultante(
  cambios: { email?: string | null; telefono?: string | null },
  actual: { email: string | null; telefono: string | null },
): void {
  const email = cambios.email !== undefined ? cambios.email : actual.email;
  const telefono =
    cambios.telefono !== undefined ? cambios.telefono : actual.telefono;
  if (!email && !telefono) {
    throw new BadRequestException(
      "Debe indicar un correo o un número de teléfono",
    );
  }
}

/** El cliente corporativo recibe el enlace para elegir su propia contraseña. */
export function debeEnviarEnlaceDeAlta(u: {
  rol: string;
  email: string | null;
}): boolean {
  return u.rol === "cliente" && !!u.email;
}
