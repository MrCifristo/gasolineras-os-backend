import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { eq } from "drizzle-orm";
import { PasswordService } from "../../auth/password.service";
import { SessionService } from "../../auth/session.service";
import { DbService } from "../../db/db.service";
import { usuarios } from "../../db/schema";
import { CreateUsuarioDto } from "./dto/create-usuario.dto";
import { UpdateUsuarioDto } from "./dto/update-usuario.dto";

// El hash nunca sale del servicio: si se filtra en una respuesta, queda
// expuesto a fuerza bruta offline.
const CAMPOS_PUBLICOS = {
  id: usuarios.id,
  email: usuarios.email,
  telefono: usuarios.telefono,
  nombre: usuarios.nombre,
  rol: usuarios.rol,
  gasolinera_id: usuarios.gasolinera_id,
  cliente_id: usuarios.cliente_id,
  activo: usuarios.activo,
};

@Injectable()
export class UsuariosService {
  constructor(
    private readonly db: DbService,
    private readonly passwords: PasswordService,
    private readonly sesiones: SessionService,
  ) {}

  findAll() {
    return this.db.db
      .select(CAMPOS_PUBLICOS)
      .from(usuarios)
      .where(eq(usuarios.activo, true));
  }

  async findOne(id: string) {
    const [usuario] = await this.db.db
      .select(CAMPOS_PUBLICOS)
      .from(usuarios)
      .where(eq(usuarios.id, id))
      .limit(1);
    if (!usuario) throw new NotFoundException("Usuario no encontrado");
    return usuario;
  }

  async create(dto: CreateUsuarioDto) {
    const { password, ...datos } = dto;

    // El correo es opcional: un cliente puede tener sólo teléfono. Se exige al
    // menos uno de los dos como identificador de acceso.
    const email = datos.email ? datos.email.toLowerCase() : null;
    const telefono = datos.telefono ? datos.telefono.trim() : null;
    if (!email && !telefono) {
      throw new BadRequestException(
        "Debe indicar un correo o un número de teléfono",
      );
    }

    if (email) {
      const [existente] = await this.db.db
        .select({ id: usuarios.id })
        .from(usuarios)
        .where(eq(usuarios.email, email))
        .limit(1);
      if (existente)
        throw new BadRequestException("El email ya está registrado");
    }
    if (telefono) {
      const [existente] = await this.db.db
        .select({ id: usuarios.id })
        .from(usuarios)
        .where(eq(usuarios.telefono, telefono))
        .limit(1);
      if (existente)
        throw new BadRequestException("El teléfono ya está registrado");
    }

    const [row] = await this.db.db
      .insert(usuarios)
      .values({
        email,
        telefono,
        nombre: datos.nombre,
        password_hash: await this.passwords.hashear(password),
        rol: datos.rol,
        gasolinera_id: datos.gasolinera_id ?? null,
        cliente_id: datos.cliente_id ?? null,
      })
      .returning(CAMPOS_PUBLICOS);

    return row;
  }

  async update(id: string, dto: UpdateUsuarioDto) {
    await this.findOne(id);
    const { password, ...resto } = dto;

    const cambios: Partial<typeof usuarios.$inferInsert> = { ...resto };
    if (resto.email) cambios.email = resto.email.toLowerCase();
    if (resto.telefono) cambios.telefono = resto.telefono.trim();

    if (password) {
      cambios.password_hash = await this.passwords.hashear(password);
      cambios.password_actualizado_at = new Date();
    }

    const [row] = await this.db.db
      .update(usuarios)
      .set(cambios)
      .where(eq(usuarios.id, id))
      .returning(CAMPOS_PUBLICOS);

    // Cambiar la contraseña tiene que echar las sesiones abiertas: si no,
    // quien tuviera la contraseña vieja sigue adentro con su refresh token.
    if (password) await this.sesiones.revocarTodasDelUsuario(id);

    return row;
  }

  /** Baja lógica: la fila queda por integridad referencial con los despachos. */
  async remove(id: string) {
    await this.findOne(id);

    const [row] = await this.db.db
      .update(usuarios)
      .set({ activo: false })
      .where(eq(usuarios.id, id))
      .returning(CAMPOS_PUBLICOS);

    // Sin esto el usuario desactivado seguiría operando con su sesión abierta.
    await this.sesiones.revocarTodasDelUsuario(id);

    return row;
  }
}
