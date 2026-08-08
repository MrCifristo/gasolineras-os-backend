import { Global, Module } from "@nestjs/common";
import { ThrottlerModule } from "@nestjs/throttler";
import { AuthController } from "./auth.controller";
import { AuthGuard } from "./auth.guard";
import { AuthService } from "./auth.service";
import { PasswordResetService } from "./password-reset.service";
import { PasswordService } from "./password.service";
import { RolesGuard } from "./roles.guard";
import { SessionService } from "./session.service";
import { TokenService } from "./token.service";

// Global porque @Auth() aplica AuthGuard/RolesGuard en casi todos los módulos,
// y el guard necesita resolver TokenService y SessionService en el contexto de
// cada uno. Igual que DbModule, es una preocupación transversal.
@Global()
@Module({
  imports: [
    // Límite base para lo que use ThrottlerGuard; /auth/login y /auth/refresh
    // lo aprietan más con @Throttle.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 60 }]),
  ],
  controllers: [AuthController],
  providers: [
    AuthGuard,
    RolesGuard,
    AuthService,
    PasswordService,
    PasswordResetService,
    TokenService,
    SessionService,
  ],
  // PasswordService sale para que usuarios.service hashee con los mismos
  // parámetros; SessionService, para revocar sesiones al cambiar la contraseña;
  // PasswordResetService, para que el admin mande el enlace de reset.
  exports: [
    AuthGuard,
    RolesGuard,
    PasswordService,
    PasswordResetService,
    SessionService,
    TokenService,
  ],
})
export class AuthModule {}
