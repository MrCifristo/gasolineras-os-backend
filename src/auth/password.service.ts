import { Injectable } from "@nestjs/common";
import { hash, verify } from "@node-rs/argon2";
import { randomInt } from "node:crypto";

// Sin I/l/1/O/0: la contraseña temporal se dicta por teléfono o se copia de un
// papel, y esos caracteres se confunden.
const ALFABETO = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";

// El enum Algorithm de @node-rs/argon2 es un `const enum`, que no se puede
// importar bajo isolatedModules. Argon2id === 2 en ese enum.
const ARGON2ID = 2;

/**
 * Hashing de contraseñas con Argon2id.
 *
 * Los parámetros son los que recomienda OWASP para Argon2id y viven sólo acá:
 * subirlos después es cambiar una constante, y `verify` sigue aceptando los
 * hashes viejos porque el costo va codificado dentro del propio hash.
 */
@Injectable()
export class PasswordService {
  // 19 MiB por hasheo. Esto es memoria real por intento concurrente de login,
  // y por eso /auth/login lleva rate limit: sin él, es un DoS por memoria.
  private readonly opciones = {
    algorithm: ARGON2ID,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  };

  async hashear(passwordPlano: string): Promise<string> {
    return hash(passwordPlano, this.opciones);
  }

  /**
   * Contraseña temporal para el alta de un usuario o un reset del admin. Se
   * devuelve en claro una sola vez, en la respuesta, y nunca se persiste así.
   *
   * `randomInt` y no `randomBytes % n`: el módulo sesga el reparto hacia los
   * primeros caracteres del alfabeto.
   */
  generarTemporal(largo = 14): string {
    let salida = "";
    for (let i = 0; i < largo; i++) {
      salida += ALFABETO[randomInt(ALFABETO.length)];
    }
    return salida;
  }

  /**
   * Devuelve false ante un hash corrupto o de formato desconocido en vez de
   * lanzar: un error acá sería un 500 en el login y distinguiría "usuario con
   * hash roto" de "contraseña incorrecta".
   */
  async verificar(
    hashGuardado: string,
    passwordPlano: string,
  ): Promise<boolean> {
    try {
      return await verify(hashGuardado, passwordPlano, this.opciones);
    } catch {
      return false;
    }
  }
}
