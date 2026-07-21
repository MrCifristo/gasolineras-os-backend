import { Injectable, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as jwt from "jsonwebtoken";
import type { Role } from "./roles.decorator";

export const JWT_ISS = "estacionflow-api";
export const JWT_AUD = "estacionflow-app";
export const ACCESS_TTL_SEGUNDOS = 15 * 60;

export interface AccessClaims {
  sub: string; // usuarios.id
  rol: Role;
  gasolinera_id: string | null;
  cliente_id: string | null;
  sid: string; // sesiones.id — permite revocar sin esperar a que expire
}

@Injectable()
export class TokenService implements OnModuleInit {
  private secreto!: string;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const secreto = this.config.get<string>("JWT_ACCESS_SECRET");
    // Falla al arrancar, no en el primer login. Un secreto débil o ausente
    // hace forjable cualquier token, así que no hay default de cortesía.
    if (!secreto || secreto.length < 32) {
      throw new Error(
        "JWT_ACCESS_SECRET debe estar definido y tener al menos 32 caracteres. " +
          "Generá uno con: openssl rand -base64 48",
      );
    }
    this.secreto = secreto;
  }

  firmarAccess(claims: AccessClaims): string {
    return jwt.sign(claims, this.secreto, {
      algorithm: "HS256",
      expiresIn: ACCESS_TTL_SEGUNDOS,
      issuer: JWT_ISS,
      audience: JWT_AUD,
    });
  }

  /**
   * Devuelve null en vez de lanzar: expirado, firmado con otro secreto o
   * manipulado son todos "no autenticado" para quien llama.
   */
  verificarAccess(token: string): AccessClaims | null {
    try {
      const payload = jwt.verify(token, this.secreto, {
        // Fijar el algoritmo evita el ataque clásico de alg:none o de
        // degradar a un algoritmo más débil.
        algorithms: ["HS256"],
        issuer: JWT_ISS,
        audience: JWT_AUD,
      });
      if (typeof payload === "string") return null;
      return payload as unknown as AccessClaims;
    } catch {
      return null;
    }
  }
}
