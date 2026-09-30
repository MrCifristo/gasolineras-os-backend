import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull, or } from "drizzle-orm";
import { DbService } from "../db/db.service";
import { tokensReset, usuarios } from "../db/schema";
import { escaparHtml } from "../common/escapar-html";
import { MailService } from "../mail/mail.service";
import { PasswordService } from "./password.service";
import { SessionService } from "./session.service";

/** Lo mínimo para armar el correo: no hace falta la fila entera del usuario. */
export interface DestinatarioReset {
  id: string;
  email: string | null;
  nombre: string;
}

/** Corto a propósito: es un enlace de recuperación, no una sesión. */
const TTL_MINUTOS = 60;

@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger("PasswordReset");

  constructor(
    private readonly db: DbService,
    private readonly passwords: PasswordService,
    private readonly sesiones: SessionService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  private hashear(tokenPlano: string): string {
    return createHash("sha256").update(tokenPlano).digest("hex");
  }

  /**
   * Emite un token y devuelve el texto plano, que sólo existe acá y en el
   * correo. Invalida los tokens vivos anteriores del usuario: si no, cada
   * solicitud dejaría otro enlace válido suelto en otra bandeja de entrada.
   */
  async emitirToken(usuarioId: string): Promise<string> {
    const plano = randomBytes(32).toString("base64url");
    const ahora = new Date();

    await this.db.db
      .update(tokensReset)
      .set({ usado_at: ahora })
      .where(
        and(
          eq(tokensReset.usuario_id, usuarioId),
          isNull(tokensReset.usado_at),
        ),
      );

    await this.db.db.insert(tokensReset).values({
      usuario_id: usuarioId,
      token_hash: this.hashear(plano),
      expira_at: new Date(ahora.getTime() + TTL_MINUTOS * 60_000),
    });

    return plano;
  }

  /** Emite el token y manda el correo. Lanza si el usuario no tiene correo. */
  async enviarEnlace(usuario: DestinatarioReset): Promise<void> {
    if (!usuario.email) {
      throw new BadRequestException(
        "El usuario no tiene correo registrado; usá el modo de contraseña generada",
      );
    }

    const token = await this.emitirToken(usuario.id);
    const base = this.config.get<string>("FRONTEND_URL") ?? "";
    const enlace = `${base.replace(/\/$/, "")}/reset?token=${token}`;

    await this.mail.enviar({
      para: usuario.email,
      asunto: "Restablecé tu contraseña — EstacionFlow",
      texto:
        `Hola ${usuario.nombre}:\n\n` +
        `Para elegir una contraseña nueva entrá acá:\n${enlace}\n\n` +
        `El enlace vence en ${TTL_MINUTOS} minutos y sirve una sola vez.\n` +
        `Si no pediste esto, ignorá el correo: tu contraseña sigue igual.\n`,
      html:
        `<p>Hola ${escaparHtml(usuario.nombre)}:</p>` +
        `<p>Para elegir una contraseña nueva entrá acá:</p>` +
        `<p><a href="${escaparHtml(enlace)}">Restablecer mi contraseña</a></p>` +
        `<p>El enlace vence en ${TTL_MINUTOS} minutos y sirve una sola vez.</p>` +
        `<p>Si no pediste esto, ignorá el correo: tu contraseña sigue igual.</p>`,
    });
  }

  /**
   * Punto de entrada público. **Nunca** revela si el identificador existe:
   * responde igual en todos los casos, porque distinguirlos convierte este
   * endpoint en un oráculo para enumerar cuentas.
   */
  async solicitar(identificador: string): Promise<void> {
    const limpio = identificador.trim();
    const normalizado = limpio.includes("@") ? limpio.toLowerCase() : limpio;

    const [usuario] = await this.db.db
      .select()
      .from(usuarios)
      .where(
        or(eq(usuarios.email, normalizado), eq(usuarios.telefono, normalizado)),
      )
      .limit(1);

    if (!usuario?.activo || !usuario.email) return;

    try {
      await this.enviarEnlace(usuario);
    } catch (e) {
      // Un fallo del proveedor no puede filtrarse al cliente: cambiaría la
      // respuesta sólo para los identificadores que sí existen.
      this.logger.error(
        `No se pudo enviar el reset a ${usuario.email}`,
        e as Error,
      );
    }
  }

  /**
   * Consume el token y fija la contraseña nueva. Un solo mensaje de error para
   * token inexistente, usado o vencido: separarlos le diría a quien prueba
   * tokens cuál de los tres está tocando.
   */
  async reset(tokenPlano: string, passwordNueva: string): Promise<void> {
    const hash = this.hashear(tokenPlano);
    const ahora = new Date();

    const [fila] = await this.db.db
      .select()
      .from(tokensReset)
      .where(eq(tokensReset.token_hash, hash))
      .limit(1);

    if (!fila || fila.usado_at || fila.expira_at <= ahora) {
      throw new BadRequestException(
        "El enlace de recuperación no es válido o ya venció",
      );
    }

    const [usuario] = await this.db.db
      .select()
      .from(usuarios)
      .where(eq(usuarios.id, fila.usuario_id))
      .limit(1);

    if (!usuario?.activo) {
      throw new BadRequestException(
        "El enlace de recuperación no es válido o ya venció",
      );
    }

    await this.db.db
      .update(usuarios)
      .set({
        password_hash: await this.passwords.hashear(passwordNueva),
        password_actualizado_at: ahora,
      })
      .where(eq(usuarios.id, usuario.id));

    await this.db.db
      .update(tokensReset)
      .set({ usado_at: ahora })
      .where(eq(tokensReset.id, fila.id));

    // Quien haya entrado con la contraseña vieja se queda afuera. Sin esto, el
    // reset no sirve para recuperar una cuenta ya comprometida.
    await this.sesiones.revocarTodasDelUsuario(usuario.id);
  }
}
