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
  const email = datos.email ? datos.email.toLowerCase() : null;
  const telefono = datos.telefono ? datos.telefono.trim() : null;
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

/** Normaliza correo y teléfono sin mutar la entrada ni agregar claves. */
export function normalizarCambios<
  T extends { email?: string | null; telefono?: string | null },
>(cambios: T): T {
  const resultado = { ...cambios };
  if (cambios.email) resultado.email = cambios.email.toLowerCase();
  if (cambios.telefono) resultado.telefono = cambios.telefono.trim();
  return resultado;
}

/**
 * La empresa que quedaría tras la edición. Que la clave venga con `null`
 * cuenta: es quitarle la empresa; sin la clave, se conserva la actual.
 */
export function clienteIdResultante(
  resto: { cliente_id?: string | null },
  actual: { cliente_id: string | null },
): string | null | undefined {
  return "cliente_id" in resto ? resto.cliente_id : actual.cliente_id;
}

/** El cliente corporativo recibe el enlace para elegir su propia contraseña. */
export function debeEnviarEnlaceDeAlta(u: {
  rol: string;
  email: string | null;
}): boolean {
  return u.rol === "cliente" && !!u.email;
}
