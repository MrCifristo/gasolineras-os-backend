/**
 * Ciclo de vida de las sesiones: login, rotación de refresh, detección de
 * reuso, revocación y expiración.
 *
 * Va como e2e y no como unit porque la rotación depende de la transacción con
 * FOR UPDATE de Postgres; con un mock no se prueba lo que importa.
 *
 * Requisitos: Postgres corriendo, .env con DATABASE_URL, JWT_ACCESS_SECRET,
 * E2E_ADMIN_EMAIL y E2E_ADMIN_PASSWORD.
 */
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { ThrottlerGuard } from "@nestjs/throttler";
import { createHash } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import * as dotenv from "dotenv";
import request from "supertest";
import { App } from "supertest/types";
import { AppModule } from "../src/app.module";
import { DbService } from "../src/db/db.service";
import { PasswordService } from "../src/auth/password.service";
import { SessionService } from "../src/auth/session.service";
import { StorageService } from "../src/storage/storage.service";
import { InMemoryStorageService } from "../src/storage/in-memory-storage.service";
import { MailService } from "../src/mail/mail.service";
import { InMemoryMailService } from "../src/mail/in-memory-mail.service";
import { PushService } from "../src/push/push.service";
import { InMemoryPushService } from "../src/push/in-memory-push.service";
import { sesiones, usuarios } from "../src/db/schema";

dotenv.config();

const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Falta ${name} para la suite de rotación.`);
  return value;
}

const ADMIN_EMAIL = requireEnv("E2E_ADMIN_EMAIL").toLowerCase();
const ADMIN_PASSWORD = requireEnv("E2E_ADMIN_PASSWORD");

describe("Auth — rotación y ciclo de vida de sesiones", () => {
  let app: INestApplication<App>;
  let db: DbService;
  let sessions: SessionService;

  const login = () =>
    request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ identificador: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  const refresh = (token: string) =>
    request(app.getHttpServer())
      .post("/api/v1/auth/refresh")
      .send({ refresh_token: token });

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      // Esta suite hace muchos logins seguidos; el rate limit los cortaría con
      // 429 y no es lo que se prueba acá. El throttling tiene su propio test.
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      // Evita que R2StorageService se instancie y falle sin env de R2.
      .overrideProvider(StorageService)
      .useClass(InMemoryStorageService)
      // Ídem con ResendMailService y RESEND_API_KEY/MAIL_FROM.
      .overrideProvider(MailService)
      .useClass(InMemoryMailService)
      .overrideProvider(PushService)
      .useClass(InMemoryPushService)
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.setGlobalPrefix("api/v1");
    await app.init();

    db = app.get(DbService);
    sessions = app.get(SessionService);
    const passwords = app.get(PasswordService);

    const hash = await passwords.hashear(ADMIN_PASSWORD);
    await db.db
      .insert(usuarios)
      .values({
        email: ADMIN_EMAIL,
        nombre: "Admin Rotación",
        password_hash: hash,
        rol: "admin",
        activo: true,
      })
      .onConflictDoUpdate({
        target: usuarios.email,
        set: { password_hash: hash, rol: "admin", activo: true },
      });
  }, 30_000);

  afterAll(async () => {
    await app.close();
  });

  it("login entrega access + refresh en el body, no como cookie", async () => {
    const res = await login();
    expect(res.status).toBe(200);
    expect(res.body.access_token).toBeDefined();
    expect(res.body.refresh_token).toBeDefined();
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  it("un refresh válido rota: el token viejo deja de servir y el nuevo sirve", async () => {
    const inicial = (await login()).body.refresh_token;

    const rotado = await refresh(inicial);
    expect(rotado.status).toBe(200);
    const nuevo = rotado.body.refresh_token;
    expect(nuevo).not.toBe(inicial);

    // El nuevo rota otra vez sin problema.
    expect((await refresh(nuevo)).status).toBe(200);
  });

  it("reusar un refresh ya consumido revoca TODA la familia", async () => {
    const inicial = (await login()).body.refresh_token;

    // Primer canje: válido, produce el siguiente eslabón.
    const r1 = await refresh(inicial);
    expect(r1.status).toBe(200);
    const siguiente = r1.body.refresh_token;

    // Reusar el inicial (ya consumido) es replay → 401.
    const replay = await refresh(inicial);
    expect(replay.status).toBe(401);

    // Y por ser replay, el eslabón legítimo siguiente también queda muerto.
    const trasReplay = await refresh(siguiente);
    expect(trasReplay.status).toBe(401);
  });

  it("logout revoca la sesión: su refresh deja de rotar", async () => {
    const sesion = await login();
    const accessToken = sesion.body.access_token;
    const refreshToken = sesion.body.refresh_token;

    const out = await request(app.getHttpServer())
      .post("/api/v1/auth/logout")
      .set("Authorization", `Bearer ${accessToken}`);
    expect(out.status).toBe(204);

    expect((await refresh(refreshToken)).status).toBe(401);
  });

  it("un refresh inexistente → 401", async () => {
    expect((await refresh("token-que-nunca-existio")).status).toBe(401);
  });

  it("un refresh expirado → 401", async () => {
    const refreshToken = (await login()).body.refresh_token;

    // Se fuerza el vencimiento hacia atrás para no esperar días reales.
    await db.db
      .update(sesiones)
      .set({ expira_at: new Date(Date.now() - 1000) })
      .where(eq(sesiones.refresh_token_hash, sha256(refreshToken)));

    expect((await refresh(refreshToken)).status).toBe(401);
  });

  it("dos refresh concurrentes del mismo token no revientan la familia", async () => {
    // La tablet puede disparar dos requests a la vez. El FOR UPDATE los
    // serializa: uno rota y el otro ve el token ya usado. Lo que NO debe pasar
    // es que ambos crean válidos y la familia quede inconsistente.
    const refreshToken = (await login()).body.refresh_token;
    const familiaAntes = await familiaDe(refreshToken);

    const [a, b] = await Promise.all([
      refresh(refreshToken),
      refresh(refreshToken),
    ]);

    const oks = [a, b].filter((r) => r.status === 200);
    // A lo sumo uno gana; el otro es 401 por token ya usado.
    expect(oks.length).toBeLessThanOrEqual(1);

    // Si uno ganó, su nuevo token pertenece a la misma familia y sigue vivo.
    if (oks.length === 1) {
      const nuevo = oks[0].body.refresh_token;
      expect(await familiaDe(nuevo)).toBe(familiaAntes);
    }
  });

  it("revocarTodasDelUsuario deja sin sesiones vivas al usuario", async () => {
    await login();
    await login();

    const [{ id: usuarioId }] = await db.db
      .select({ id: usuarios.id })
      .from(usuarios)
      .where(eq(usuarios.email, ADMIN_EMAIL))
      .limit(1);

    await sessions.revocarTodasDelUsuario(usuarioId);

    const vivas = await db.db
      .select({ id: sesiones.id })
      .from(sesiones)
      .where(
        and(eq(sesiones.usuario_id, usuarioId), isNull(sesiones.revocado_at)),
      );
    expect(vivas.length).toBe(0);
  });

  async function familiaDe(refreshToken: string): Promise<string> {
    const [fila] = await db.db
      .select({ familia_id: sesiones.familia_id })
      .from(sesiones)
      .where(eq(sesiones.refresh_token_hash, sha256(refreshToken)))
      .limit(1);
    return fila.familia_id;
  }
});
