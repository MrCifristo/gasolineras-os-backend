import type { LaunchOptions } from "puppeteer";

/**
 * Opciones de lanzamiento de Chrome para los PDF (reportes y estado de cuenta).
 *
 * El sandbox queda activo por defecto: el HTML lleva datos del cliente
 * (gráficas en data: que Chrome decodifica y texto de la base), así que un
 * escape del renderer llegaría al proceso que tiene DATABASE_URL y los secretos.
 *
 * Railway no deja dar SYS_ADMIN ni cambiar seccomp, y sin eso ni el sandbox de
 * namespaces ni el SUID arrancan (probado en Docker el 8-oct-2026). Milton
 * decidió: probar en Railway y, si no hay sandbox, apagarlo con
 * CHROME_SIN_SANDBOX=true, confiando en lo demás (JS apagado, red bloqueada
 * salvo data:, data URLs validadas, sólo usuarios autenticados). Sólo "true"
 * lo apaga; cualquier otro valor deja el sandbox.
 */
export function opcionesChrome(
  sinSandbox = process.env.CHROME_SIN_SANDBOX,
): LaunchOptions {
  return sinSandbox === "true"
    ? { headless: true, args: ["--no-sandbox"] }
    : { headless: true };
}
