import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { Throttle, ThrottlerGuard } from "@nestjs/throttler";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { AuthService } from "./auth.service";
import { AuthGuard, COOKIE_ACCESS } from "./auth.guard";
import { LoginDto } from "./dto/login.dto";
import { RefreshDto } from "./dto/refresh.dto";
import { ResetPasswordDto } from "./dto/reset-password.dto";
import { SolicitarResetDto } from "./dto/solicitar-reset.dto";
import { PasswordResetService } from "./password-reset.service";
import { TokenService } from "./token.service";
import type { MetaSesion } from "./session.service";

function meta(req: Request): MetaSesion {
  return { userAgent: req.headers["user-agent"] ?? null, ip: req.ip ?? null };
}

@ApiTags("auth")
@Controller("auth")
export class AuthController {
  constructor(
    private readonly service: AuthService,
    private readonly tokens: TokenService,
    private readonly reset: PasswordResetService,
  ) {}

  /**
   * Devuelve los tokens en el body. El BFF de Next es quien los convierte en
   * cookies httpOnly; el backend se mantiene como API bearer pura.
   */
  @Post("login")
  @HttpCode(HttpStatus.OK)
  // Argon2 reserva 19 MiB por intento: sin límite, un puñado de requests
  // concurrentes tumban el proceso por memoria.
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: "Iniciar sesión" })
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.service.login(dto, meta(req));
  }

  @Post("refresh")
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: "Rotar el refresh token" })
  refresh(@Body() dto: RefreshDto, @Req() req: Request) {
    return this.service.refresh(dto.refresh_token, meta(req));
  }

  /**
   * Público. Responde 204 siempre — exista o no el identificador, tenga o no
   * correo, falle o no el proveedor. Cualquier diferencia de respuesta serviría
   * para enumerar cuentas.
   */
  @Post("password/solicitar")
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: "Solicitar enlace de recuperación de contraseña" })
  async solicitarReset(@Body() dto: SolicitarResetDto) {
    await this.reset.solicitar(dto.identificador);
  }

  /** Público: la credencial acá es el token del correo, no una sesión. */
  @Post("password/reset")
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: "Fijar contraseña nueva con el token del correo" })
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.reset.reset(dto.token, dto.password);
  }

  /** Revoca la familia entera de la sesión actual, no sólo el eslabón vigente. */
  @Post("logout")
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(AuthGuard)
  @ApiBearerAuth("JWT")
  @ApiOperation({ summary: "Cerrar la sesión actual" })
  async logout(@Req() req: Request) {
    await this.service.logout(this.leerClaims(req).sid);
  }

  @Post("logout-all")
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(AuthGuard)
  @ApiBearerAuth("JWT")
  @ApiOperation({ summary: "Cerrar todas las sesiones del usuario" })
  async logoutAll(@Req() req: Request) {
    await this.service.logoutTodas(req.user!.id);
  }

  @Get("me")
  @UseGuards(AuthGuard)
  @ApiBearerAuth("JWT")
  @ApiOperation({ summary: "Perfil del usuario autenticado" })
  me(@Req() req: Request) {
    return this.service.me(req.user!);
  }

  /** El `sid` viaja dentro del access token, y el guard no lo deja en el request. */
  private leerClaims(req: Request) {
    const cookies = req.cookies as Record<string, string> | undefined;
    const header = req.headers.authorization;
    const token =
      cookies?.[COOKIE_ACCESS] ??
      (header?.startsWith("Bearer ") ? header.slice(7) : null);
    const claims = token ? this.tokens.verificarAccess(token) : null;
    // El guard ya validó este mismo token, así que no debería darse nunca.
    if (!claims) throw new UnauthorizedException("Token inválido");
    return claims;
  }
}
