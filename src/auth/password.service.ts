import { Injectable } from "@nestjs/common";
import { hash, verify } from "@node-rs/argon2";

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
