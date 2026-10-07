// test/unit/esperar-error.ts
// Helpers de aserción para las specs unitarias. Verifican la CLASE y el MENSAJE
// exacto de la excepción: `toThrow(new X("m"))` sólo compara el mensaje y
// `toThrow("m")` acepta substrings, así que ninguno detecta un 403 que debía
// ser 404 ni un mensaje recortado.
type ClaseError = abstract new (...args: any[]) => Error;

function verificar(
  capturado: unknown,
  lanzo: boolean,
  Clase: ClaseError,
  mensaje: string,
): void {
  if (!lanzo) {
    throw new Error(
      `Se esperaba ${Clase.name}("${mensaje}") pero no se lanzó nada`,
    );
  }
  if (!(capturado instanceof Clase)) {
    const real =
      capturado instanceof Error
        ? capturado.constructor.name
        : typeof capturado;
    throw new Error(`Se esperaba ${Clase.name} pero se lanzó ${real}`);
  }
  if (capturado.message !== mensaje) {
    throw new Error(
      `Mensaje distinto.\n  esperado: "${mensaje}"\n  recibido: "${capturado.message}"`,
    );
  }
}

export function esperarError(
  fn: () => unknown,
  Clase: ClaseError,
  mensaje: string,
): void {
  let capturado: unknown;
  let lanzo = false;
  try {
    fn();
  } catch (e) {
    lanzo = true;
    capturado = e;
  }
  verificar(capturado, lanzo, Clase, mensaje);
}

export async function esperarRechazo(
  promesa: Promise<unknown>,
  Clase: ClaseError,
  mensaje: string,
): Promise<void> {
  let capturado: unknown;
  let lanzo = false;
  try {
    await promesa;
  } catch (e) {
    lanzo = true;
    capturado = e;
  }
  verificar(capturado, lanzo, Clase, mensaje);
}
