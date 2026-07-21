import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import { SessionService } from "./session.service";
import { TokenService } from "./token.service";

export const COOKIE_ACCESS = "ef_at";

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly tokens: TokenService,
    private readonly sesiones: SessionService,
  ) {}

  /**
   * La cookie es el camino normal (la pone el BFF de Next). El header Bearer
   * queda como respaldo para Swagger y la suite e2e, que hablan con la API
   * directo y no tienen navegador que guarde cookies.
   */
  private extraerToken(req: Request): string | null {
    const cookies = req.cookies as Record<string, string> | undefined;
    const deCookie = cookies?.[COOKIE_ACCESS];
    if (deCookie) return deCookie;

    const header = req.headers.authorization;
    if (header?.startsWith("Bearer ")) return header.slice(7);

    return null;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = this.extraerToken(request);

    if (!token) throw new UnauthorizedException("Token requerido");

    const claims = this.tokens.verificarAccess(token);
    if (!claims) throw new UnauthorizedException("Token inválido");

    // La firma sólo prueba que el token es nuestro y no venció. Falta saber si
    // la sesión sigue viva: sin esta consulta, un access token de una sesión ya
    // revocada seguiría sirviendo hasta 15 minutos y revocar no serviría de nada.
    const usuario = await this.sesiones.usuarioDeSesionViva(claims.sid);
    if (!usuario) throw new UnauthorizedException("Sesión no vigente");

    request.user = usuario;
    return true;
  }
}
