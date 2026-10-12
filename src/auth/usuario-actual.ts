import {
  createParamDecorator,
  UnauthorizedException,
  type ExecutionContext,
} from "@nestjs/common";
import type { Request } from "express";
import type { usuarios } from "../db/schema";

/** La fila de `usuarios` que AuthGuard cuelga del request. */
export type UsuarioSesion = typeof usuarios.$inferSelect;

/**
 * El usuario autenticado, tipado. Va junto con `@Auth(...)`: si una ruta lo
 * pide sin el guard, responde 401 en vez de dejar pasar `undefined` y que el
 * alcance por rol se salte en silencio.
 */
export const UsuarioActual = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): UsuarioSesion => {
    const { user } = ctx.switchToHttp().getRequest<Request>();
    if (!user) throw new UnauthorizedException("Token requerido");
    return user;
  },
);
