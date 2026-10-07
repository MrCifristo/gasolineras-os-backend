import { Injectable, UnauthorizedException } from "@nestjs/common";
import { DbService } from "../db/db.service";
import { usuarios } from "../db/schema";
import { normalizarIdentificador } from "./auth.reglas";
import { buscarUsuarioPorIdentificador } from "./buscar-usuario";
import { LoginDto } from "./dto/login.dto";
import { PasswordService } from "./password.service";
import { SessionService, type MetaSesion } from "./session.service";
import { TokenService, ACCESS_TTL_SEGUNDOS } from "./token.service";

type Usuario = typeof usuarios.$inferSelect;

export interface RespuestaAuth {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  usuario: {
    id: string;
    email: string | null;
    telefono: string | null;
    nombre: string;
    rol: Usuario["rol"];
    gasolinera_id: string | null;
    cliente_id: string | null;
  };
}

@Injectable()
export class AuthService {
  constructor(
    private readonly db: DbService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly sesiones: SessionService,
  ) {}

  private async buscarPorIdentificador(
    identificador: string,
  ): Promise<Usuario | undefined> {
    return buscarUsuarioPorIdentificador(this.db, identificador);
  }

  private perfil(u: Usuario): RespuestaAuth["usuario"] {
    return {
      id: u.id,
      email: u.email,
      telefono: u.telefono,
      nombre: u.nombre,
      rol: u.rol,
      gasolinera_id: u.gasolinera_id,
      cliente_id: u.cliente_id,
    };
  }

  /**
   * Los tokens salen en el body, NO como Set-Cookie: quien los convierte en
   * cookies httpOnly es el BFF de Next. Así el backend nunca actúa sobre
   * credenciales ambientales y queda estructuralmente inmune a CSRF.
   */
  async login(dto: LoginDto, meta: MetaSesion = {}): Promise<RespuestaAuth> {
    const usuario = await this.buscarPorIdentificador(
      normalizarIdentificador(dto.identificador),
    );

    // Se hashea aunque el usuario no exista, para que el tiempo de respuesta
    // no delate qué correos/teléfonos están registrados.
    const hashComparable = usuario?.password_hash ?? (await this.hashSenuelo());
    const coincide = await this.passwords.verificar(
      hashComparable,
      dto.password,
    );

    // Un solo mensaje para usuario inexistente, contraseña mala y cuenta
    // desactivada: no se le regala información a quien prueba credenciales.
    if (!usuario || !coincide || !usuario.activo) {
      throw new UnauthorizedException("Credenciales inválidas");
    }

    const sesion = await this.sesiones.crear(usuario, meta);

    return {
      access_token: this.tokens.firmarAccess({
        sub: usuario.id,
        rol: usuario.rol,
        gasolinera_id: usuario.gasolinera_id,
        cliente_id: usuario.cliente_id,
        sid: sesion.sid,
      }),
      refresh_token: sesion.refreshToken,
      expires_in: ACCESS_TTL_SEGUNDOS,
      usuario: this.perfil(usuario),
    };
  }

  async refresh(
    refreshToken: string,
    meta: MetaSesion = {},
  ): Promise<RespuestaAuth> {
    const { usuario, sesion } = await this.sesiones.rotar(refreshToken, meta);

    return {
      access_token: this.tokens.firmarAccess({
        sub: usuario.id,
        rol: usuario.rol,
        gasolinera_id: usuario.gasolinera_id,
        cliente_id: usuario.cliente_id,
        sid: sesion.sid,
      }),
      refresh_token: sesion.refreshToken,
      expires_in: ACCESS_TTL_SEGUNDOS,
      usuario: this.perfil(usuario),
    };
  }

  async logout(sid: string): Promise<void> {
    await this.sesiones.revocarPorSid(sid);
  }

  async logoutTodas(usuarioId: string): Promise<void> {
    await this.sesiones.revocarTodasDelUsuario(usuarioId);
  }

  me(usuario: Usuario): RespuestaAuth["usuario"] {
    return this.perfil(usuario);
  }

  // Hash descartable contra un correo inexistente. Sin esto el login respondería
  // mucho más rápido para correos no registrados y permitiría enumerarlos.
  private senueloCacheado?: string;
  private async hashSenuelo(): Promise<string> {
    this.senueloCacheado ??= await this.passwords.hashear(
      "senuelo-para-igualar-el-tiempo-de-respuesta",
    );
    return this.senueloCacheado;
  }
}
