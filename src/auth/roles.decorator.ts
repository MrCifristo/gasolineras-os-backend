import { SetMetadata, UseGuards, applyDecorators } from "@nestjs/common";
import { AuthGuard } from "./auth.guard";
import { RolesGuard } from "./roles.guard";

export type Role = "admin" | "supervisor" | "cliente" | "jefe_pista";

export const ROLES_KEY = "roles";
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

export const Auth = (...roles: Role[]) =>
  applyDecorators(Roles(...roles), UseGuards(AuthGuard, RolesGuard));
