import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { ROLES_KEY, Role } from "./roles.decorator";

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) return true;

    // AuthGuard corre antes y deja el usuario tipado en el request.
    const { user } = context.switchToHttp().getRequest<Request>();
    if (!user || !requiredRoles.includes(user.rol)) {
      throw new ForbiddenException("Permisos insuficientes");
    }
    return true;
  }
}
