import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { eq } from "drizzle-orm";
import { DbService } from "../db/db.service";
import { usuarios } from "../db/schema";

@Injectable()
export class AuthGuard implements CanActivate {
  private supabase: SupabaseClient;

  constructor(
    private config: ConfigService,
    private db: DbService,
  ) {
    this.supabase = createClient(
      this.config.get<string>("SUPABASE_URL")!,
      this.config.get<string>("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader: string | undefined = request.headers["authorization"];

    if (!authHeader?.startsWith("Bearer ")) {
      throw new UnauthorizedException("Token requerido");
    }

    const token = authHeader.slice(7);

    // Validar el JWT delegando a Supabase Auth (soporta HS256 y ES256)
    const { data, error } = await this.supabase.auth.getUser(token);
    if (error || !data.user) {
      throw new UnauthorizedException("Token inválido");
    }

    const [usuario] = await this.db.db
      .select()
      .from(usuarios)
      .where(eq(usuarios.supabase_user_id, data.user.id))
      .limit(1);

    if (!usuario || !usuario.activo) {
      throw new UnauthorizedException("Usuario no autorizado");
    }

    request.user = usuario;
    return true;
  }
}
