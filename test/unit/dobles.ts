import type { UsuarioSesion } from "../../src/auth/usuario-actual";

/**
 * Dobles de prueba sin `any`.
 *
 * `vacio<T>()`: un objeto vacío del tipo que pide el constructor, para
 * dependencias que el caso no toca (si las tocara, lanzaría). El tipo sale del
 * contexto: `new Servicio(vacio(), config)`.
 */
export function vacio<T>(): T {
  return {} as unknown as T;
}

/**
 * `jest.spyOn` sobre un método privado y asíncrono (el tipo público no lo
 * expone). Admite mockResolvedValue/mockRejectedValue con cualquier valor.
 */
export function espiarPrivado(obj: object, metodo: string) {
  return jest.spyOn(
    obj as Record<string, (...args: unknown[]) => Promise<unknown>>,
    metodo,
  );
}

/** Usuario de sesión completo con lo que el caso no fija en valores neutros. */
export function usuarioDePrueba(
  datos: Partial<UsuarioSesion> & Pick<UsuarioSesion, "rol">,
): UsuarioSesion {
  return {
    id: "u-prueba",
    nombre: "Usuario de prueba",
    email: null,
    telefono: null,
    password_hash: "",
    password_actualizado_at: new Date(0),
    activo: true,
    gasolinera_id: null,
    cliente_id: null,
    ...datos,
  };
}
