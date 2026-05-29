import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { eq } from "drizzle-orm";
import { DbService } from "../../db/db.service";
import { usuarios } from "../../db/schema";
import { CreateUsuarioDto } from "./dto/create-usuario.dto";
import { UpdateUsuarioDto } from "./dto/update-usuario.dto";

@Injectable()
export class UsuariosService {
  private supabaseAdmin: SupabaseClient;

  constructor(
    private db: DbService,
    private config: ConfigService,
  ) {
    this.supabaseAdmin = createClient(
      this.config.get<string>("SUPABASE_URL")!,
      this.config.get<string>("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
  }

  findAll() {
    return this.db.db.select().from(usuarios).where(eq(usuarios.activo, true));
  }

  async findOne(id: string) {
    const [usuario] = await this.db.db
      .select()
      .from(usuarios)
      .where(eq(usuarios.id, id))
      .limit(1);
    if (!usuario) throw new NotFoundException("Usuario no encontrado");
    return usuario;
  }

  async create(dto: CreateUsuarioDto) {
    const { password, ...userData } = dto;

    const { data: authData, error: authError } =
      await this.supabaseAdmin.auth.admin.createUser({
        email: userData.email,
        password,
        email_confirm: true,
      });

    if (authError) {
      if (authError.message.includes("already registered")) {
        throw new BadRequestException("El email ya está registrado");
      }
      throw new InternalServerErrorException(
        `Error al crear usuario en Auth: ${authError.message}`,
      );
    }

    const [row] = await this.db.db
      .insert(usuarios)
      .values({
        supabase_user_id: authData.user.id,
        email: userData.email,
        nombre: userData.nombre,
        rol: userData.rol,
        gasolinera_id: userData.gasolinera_id ?? null,
        cliente_id: userData.cliente_id ?? null,
      })
      .returning();

    return row;
  }

  async update(id: string, dto: UpdateUsuarioDto) {
    const usuario = await this.findOne(id);
    const { password, ...rest } = dto;

    if (dto.email || password) {
      const authUpdate: Record<string, unknown> = {};
      if (dto.email) authUpdate.email = dto.email;
      if (password) authUpdate.password = password;

      const { error } = await this.supabaseAdmin.auth.admin.updateUserById(
        usuario.supabase_user_id,
        authUpdate,
      );
      if (error) {
        throw new InternalServerErrorException(
          `Error al actualizar Auth: ${error.message}`,
        );
      }
    }

    const dbUpdate: Partial<typeof rest> = { ...rest };
    delete (dbUpdate as any).password;

    const [row] = await this.db.db
      .update(usuarios)
      .set(dbUpdate)
      .where(eq(usuarios.id, id))
      .returning();

    return row;
  }

  async remove(id: string) {
    const usuario = await this.findOne(id);

    await this.supabaseAdmin.auth.admin.updateUserById(
      usuario.supabase_user_id,
      {
        ban_duration: "87600h",
      },
    );

    const [row] = await this.db.db
      .update(usuarios)
      .set({ activo: false })
      .where(eq(usuarios.id, id))
      .returning();

    return row;
  }
}
