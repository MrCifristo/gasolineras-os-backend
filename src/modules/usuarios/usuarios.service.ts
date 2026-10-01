import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { eq } from "drizzle-orm";
import { PasswordResetService } from "../../auth/password-reset.service";
import { PasswordService } from "../../auth/password.service";
import { SessionService } from "../../auth/session.service";
import { DbService } from "../../db/db.service";
import { usuarios } from "../../db/schema";
import { CreateUsuarioDto } from "./dto/create-usuario.dto";
import { ModoReset } from "./dto/reset-password-admin.dto";
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

/**
 * Un usuario cliente sin empresa no tiene alcance: los servicios fallan
 * cerrado con él, pero cualquier ruta que olvide hacerlo le mostraría los
 * datos de todos los clientes. Defensa en profundidad: no puede existir.
 */
function exigirEmpresaSiEsCliente(
  rol: string | undefined,
  clienteId: string | null | undefined,
) {
  if (rol === "cliente" && !clienteId) {
    throw new BadRequestException(
      "Un usuario cliente debe tener una empresa (cliente_id) asignada",
    );
  }
}

@Injectable()
export class UsuariosService {
  private readonly logger = new Logger("Usuarios");

  constructor(
    private readonly db: DbService,
    private readonly passwords: PasswordService,
    private readonly sesiones: SessionService,
    private readonly reset: PasswordResetService,
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
    exigirEmpresaSiEsCliente(datos.rol, datos.cliente_id);

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

    // Si el admin no fija una, se genera. En ambos casos el texto plano sale
    // una única vez en esta respuesta —para que el admin la descargue— y no se
    // persiste en ningún lado.
    const passwordTemporal = password ?? this.passwords.generarTemporal();

    const [row] = await this.db.db
      .insert(usuarios)
      .values({
        email,
        telefono,
        nombre: datos.nombre,
        password_hash: await this.passwords.hashear(passwordTemporal),
        rol: datos.rol,
        gasolinera_id: datos.gasolinera_id ?? null,
        cliente_id: datos.cliente_id ?? null,
      })
      .returning(CAMPOS_PUBLICOS);

    // El cliente corporativo recibe el enlace para elegir su propia contraseña.
    // Fire-and-forget: que el proveedor de correo falle no puede tumbar el alta
    // del usuario, que ya está creado y con credenciales utilizables.
    if (row.rol === "cliente" && row.email) {
      this.reset
        .enviarEnlace(row)
        .catch((e: Error) =>
          this.logger.error(
            `No se pudo enviar el enlace de alta a ${row.email}`,
            e,
          ),
        );
    }

    return { ...row, password_temporal: passwordTemporal };
  }

  /**
   * Reset iniciado por el admin. "generar" devuelve una contraseña temporal en
   * la respuesta; "enlace" manda el correo de recuperación y no devuelve nada
   * que sirva para entrar.
   */
  async resetPassword(id: string, modo: ModoReset) {
    const [usuario] = await this.db.db
      .select()
      .from(usuarios)
      .where(eq(usuarios.id, id))
      .limit(1);
    if (!usuario) throw new NotFoundException("Usuario no encontrado");

    if (modo === "enlace") {
      await this.reset.enviarEnlace(usuario);
      return { enviado: true };
    }

    const passwordTemporal = this.passwords.generarTemporal();
    await this.db.db
      .update(usuarios)
      .set({
        password_hash: await this.passwords.hashear(passwordTemporal),
        password_actualizado_at: new Date(),
      })
      .where(eq(usuarios.id, id));

    // Igual que en update(): la contraseña vieja no puede seguir dando acceso
    // a través de un refresh token abierto.
    await this.sesiones.revocarTodasDelUsuario(id);

    return { password_temporal: passwordTemporal };
  }

  async update(id: string, dto: UpdateUsuarioDto) {
    const actual = await this.findOne(id);
    const { password, ...resto } = dto;

    // Se valida el estado que quedaría: cambiar el rol a cliente sin empresa, o
    // quitarle la empresa a un cliente, también lo dejaría sin alcance.
    exigirEmpresaSiEsCliente(
      resto.rol ?? actual.rol,
      "cliente_id" in resto ? resto.cliente_id : actual.cliente_id,
    );

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
