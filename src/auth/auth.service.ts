import { Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { eq } from "drizzle-orm";
import { DbService } from "../db/db.service";
import { usuarios } from "../db/schema";
import { LoginDto } from "./dto/login.dto";

@Injectable()
export class AuthService {
  private supabase: SupabaseClient;

  constructor(
    private db: DbService,
    private config: ConfigService,
  ) {
    this.supabase = createClient(
      this.config.get<string>("SUPABASE_URL")!,
      this.config.get<string>("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
  }

  async login(dto: LoginDto) {
    const { data, error } = await this.supabase.auth.signInWithPassword({
      email: dto.email,
      password: dto.password,
    });

    if (error || !data.user) {
      throw new UnauthorizedException("Credenciales inválidas");
    }

    const [usuario] = await this.db.db
      .select()
      .from(usuarios)
      .where(eq(usuarios.supabase_user_id, data.user.id))
      .limit(1);

    if (!usuario || !usuario.activo) {
      throw new UnauthorizedException("Usuario inactivo o no registrado");
    }

    return {
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      usuario: {
        id: usuario.id,
        email: usuario.email,
        nombre: usuario.nombre,
        rol: usuario.rol,
        gasolinera_id: usuario.gasolinera_id,
        cliente_id: usuario.cliente_id,
      },
    };
  }
}
