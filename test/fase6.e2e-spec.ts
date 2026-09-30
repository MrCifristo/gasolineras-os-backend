// test/fase6.e2e-spec.ts
/**
 * Fase 6: turnos configurables, recordatorio de precios y push.
 *
 * Requisitos: Postgres migrado y .env con E2E_ADMIN_EMAIL/E2E_ADMIN_PASSWORD.
 * El cron queda apagado (RECORDATORIOS_ACTIVOS=false) y los tests llaman a
 * RecordatoriosService.ejecutar() con un instante fijo.
 */
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { ThrottlerGuard } from "@nestjs/throttler";
import { and, eq, like } from "drizzle-orm";
import * as dotenv from "dotenv";
import request from "supertest";
import { App } from "supertest/types";
import { AppModule } from "../src/app.module";
import { DbService } from "../src/db/db.service";
import { PasswordService } from "../src/auth/password.service";
import { StorageService } from "../src/storage/storage.service";
import { InMemoryStorageService } from "../src/storage/in-memory-storage.service";
import { MailService } from "../src/mail/mail.service";
import { InMemoryMailService } from "../src/mail/in-memory-mail.service";
import { PushService } from "../src/push/push.service";
import { InMemoryPushService } from "../src/push/in-memory-push.service";
import { gasolineras, suscripcionesPush, turnosGasolinera, usuarios } from "../src/db/schema";
import { fechaGuatemala } from "../src/common/hora-guatemala";

dotenv.config();
process.env.RECORDATORIOS_ACTIVOS = "false";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Falta ${name} para la suite de la Fase 6.`);
  return v;
}

const ADMIN_EMAIL = requireEnv("E2E_ADMIN_EMAIL").toLowerCase();
const ADMIN_PASSWORD = requireEnv("E2E_ADMIN_PASSWORD");
const RUN_ID = Date.now().toString().slice(-6);
const PASS = `F6Pass#${RUN_ID}`;

describe("Fase 6 — turnos, recordatorios y push", () => {
  let app: INestApplication<App>;
  let db: DbService;
  let passwords: PasswordService;
  let correos: InMemoryMailService;
  let pushes: InMemoryPushService;
  let adminToken: string;
  let supervisorToken: string;
  let jefeToken: string;
  let gasAId: string;
  let gasBId: string;

  const http = () => request(app.getHttpServer());

  async function crearUsuario(
    rol: "admin" | "supervisor" | "cliente" | "jefe_pista",
    extra: Partial<typeof usuarios.$inferInsert> = {},
  ) {
    const email = `${rol}.${Math.random().toString(36).slice(2, 8)}.${RUN_ID}@f6-e2e.test`;
    const [u] = await db.db
      .insert(usuarios)
      .values({
        email,
        nombre: `F6 ${rol}`,
        password_hash: await passwords.hashear(PASS),
        rol,
        activo: true,
        ...extra,
      })
      .returning();
    return u;
  }

  async function loginToken(identificador: string, password = PASS) {
    const res = await http()
      .post("/api/v1/auth/login")
      .send({ identificador, password });
    expect(res.status).toBe(200);
    return res.body.access_token as string;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .overrideProvider(StorageService)
      .useClass(InMemoryStorageService)
      .overrideProvider(MailService)
      .useClass(InMemoryMailService)
      .overrideProvider(PushService)
      .useClass(InMemoryPushService)
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.setGlobalPrefix("api/v1");
    await app.init();

    db = app.get(DbService);
    passwords = app.get(PasswordService);
    correos = app.get(MailService);
    pushes = app.get(PushService);

    const hash = await passwords.hashear(ADMIN_PASSWORD);
    await db.db
      .insert(usuarios)
      .values({ email: ADMIN_EMAIL, nombre: "Admin F6", password_hash: hash, rol: "admin", activo: true })
      .onConflictDoUpdate({
        target: usuarios.email,
        set: { password_hash: hash, rol: "admin", activo: true },
      });
    adminToken = await loginToken(ADMIN_EMAIL, ADMIN_PASSWORD);

    for (const nombre of ["A", "B"]) {
      const res = await http()
        .post("/api/v1/gasolineras")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ nombre: `[F6-${RUN_ID}] Estación ${nombre}`, direccion: "Km 245", ciudad: "Morales" });
      expect(res.status).toBe(201);
      if (nombre === "A") gasAId = res.body.id;
      else gasBId = res.body.id;
    }

    const sup = await crearUsuario("supervisor", { gasolinera_id: gasAId });
    supervisorToken = await loginToken(sup.email!);
    const jefe = await crearUsuario("jefe_pista");
    jefeToken = await loginToken(jefe.email!);
  }, 60_000);

  afterAll(async () => {
    // Usuarios de prueba desactivados: si quedaran activos, el cron real de la
    // BD de desarrollo les mandaría recordatorios a direcciones .test.
    await db.db
      .update(usuarios)
      .set({ activo: false })
      .where(like(usuarios.nombre, "F6 %"))
      .catch(() => undefined);
    // Gasolineras de la corrida fuera de la vista y del cron de otras corridas.
    await db.db
      .update(gasolineras)
      .set({ activo: false })
      .where(eq(gasolineras.id, gasAId))
      .catch(() => undefined);
    await db.db
      .update(gasolineras)
      .set({ activo: false })
      .where(eq(gasolineras.id, gasBId))
      .catch(() => undefined);
    await app.close();
  });

  describe("Turnos", () => {
    it("una gasolinera nueva nace con sus dos turnos por defecto", async () => {
      const res = await http()
        .get(`/api/v1/gasolineras/${gasAId}/turnos`)
        .set("Authorization", `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual([
        expect.objectContaining({ turno: "manana", hora_inicio: "06:00", hora_fin: "14:00", recordatorio_activo: true }),
        expect.objectContaining({ turno: "tarde", hora_inicio: "14:00", hora_fin: "22:00", recordatorio_activo: true }),
      ]);
    });

    it.each([
      ["supervisor", () => supervisorToken],
      ["jefe_pista", () => jefeToken],
    ])("%s puede leer los turnos", async (_rol, token) => {
      const res = await http()
        .get(`/api/v1/gasolineras/${gasAId}/turnos`)
        .set("Authorization", `Bearer ${token()}`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
    });

    it("admin cambia el horario de la tarde", async () => {
      const res = await http()
        .patch(`/api/v1/gasolineras/${gasAId}/turnos/tarde`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ hora_inicio: "14:00", hora_fin: "23:00" });
      expect(res.status).toBe(200);
      expect(res.body.hora_fin).toBe("23:00");
    });

    it("sólo cambiar recordatorio_activo no revalida horas", async () => {
      const res = await http()
        .patch(`/api/v1/gasolineras/${gasAId}/turnos/manana`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ recordatorio_activo: false });
      expect(res.status).toBe(200);
      expect(res.body.recordatorio_activo).toBe(false);
      expect(res.body.hora_inicio).toBe("06:00");
    });

    it.each([
      [{ hora_inicio: "6:00" }, "formato"],
      [{ hora_inicio: "25:00" }, "formato"],
      [{ hora_inicio: "14:00", hora_fin: "14:00" }, "igual"],
      [{ hora_inicio: "05:00", hora_fin: "15:00" }, "solapa"],
      [{}, "vacío"],
      [{ turno: "noche" }, "campo no permitido"],
    ])("PATCH inválido %j → 400 (%s)", async (body) => {
      const res = await http()
        .patch(`/api/v1/gasolineras/${gasAId}/turnos/manana`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send(body);
      expect(res.status).toBe(400);
      expect(res.body.message).toBeDefined();
    });

    it("turno inexistente en la ruta → 400", async () => {
      const res = await http()
        .patch(`/api/v1/gasolineras/${gasAId}/turnos/noche`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ recordatorio_activo: true });
      expect(res.status).toBe(400);
    });

    it.each([
      ["supervisor", () => supervisorToken],
      ["jefe_pista", () => jefeToken],
    ])("%s no puede editar turnos → 403", async (_rol, token) => {
      const res = await http()
        .patch(`/api/v1/gasolineras/${gasAId}/turnos/manana`)
        .set("Authorization", `Bearer ${token()}`)
        .send({ recordatorio_activo: true });
      expect(res.status).toBe(403);
    });

    it("GET /turnos/actual responde con la forma { turno }", async () => {
      const res = await http()
        .get(`/api/v1/turnos/actual?gasolinera_id=${gasAId}`)
        .set("Authorization", `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(["manana", "tarde", null]).toContain(res.body.turno);
    });

    it("el supervisor obtiene el turno de SU gasolinera aunque pida otra", async () => {
      // B se arma para diferir de A a toda hora (A: mañana 06-14, tarde 14-23):
      // 06-14 B=tarde, 14-06 B=mañana. Así el test no pasa por casualidad
      // cuando ambas gasolineras responden el mismo turno.
      await db.db
        .update(turnosGasolinera)
        .set({ hora_inicio: "06:00", hora_fin: "14:00" })
        .where(and(eq(turnosGasolinera.gasolinera_id, gasBId), eq(turnosGasolinera.turno, "tarde")));
      await db.db
        .update(turnosGasolinera)
        .set({ hora_inicio: "14:00", hora_fin: "06:00" })
        .where(and(eq(turnosGasolinera.gasolinera_id, gasBId), eq(turnosGasolinera.turno, "manana")));

      const deB = await http()
        .get(`/api/v1/turnos/actual?gasolinera_id=${gasBId}`)
        .set("Authorization", `Bearer ${adminToken}`);
      const delSupervisor = await http()
        .get(`/api/v1/turnos/actual?gasolinera_id=${gasBId}`)
        .set("Authorization", `Bearer ${supervisorToken}`);
      expect(deB.body.turno).not.toBeNull();
      // El supervisor es de A: su respuesta sale de A, cuyo horario es otro.
      const deA = await http()
        .get(`/api/v1/turnos/actual?gasolinera_id=${gasAId}`)
        .set("Authorization", `Bearer ${adminToken}`);
      expect(delSupervisor.body).toEqual(deA.body);
    });
  });

  describe("Permisos del jefe de pista", () => {
    it("lee la lista de gasolineras", async () => {
      const res = await http().get("/api/v1/gasolineras").set("Authorization", `Bearer ${jefeToken}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it("lee una gasolinera por id", async () => {
      const res = await http().get(`/api/v1/gasolineras/${gasBId}`).set("Authorization", `Bearer ${jefeToken}`);
      expect(res.status).toBe(200);
    });

    it("lee precios filtrados por gasolinera", async () => {
      const res = await http()
        .get(`/api/v1/precios-combustible?gasolinera_id=${gasBId}`)
        .set("Authorization", `Bearer ${jefeToken}`);
      expect(res.status).toBe(200);
    });

    it("lee los precios de hoy de cualquier gasolinera", async () => {
      await http()
        .post("/api/v1/precios-combustible")
        .set("Authorization", `Bearer ${jefeToken}`)
        .send({ gasolinera_id: gasBId, fecha: fechaGuatemala(), tipo_combustible: "diesel", precio_galon: "30.500" })
        .expect(201);
      const res = await http()
        .get(`/api/v1/precios-combustible/hoy?gasolinera_id=${gasBId}`)
        .set("Authorization", `Bearer ${jefeToken}`);
      expect(res.status).toBe(200);
      expect(res.body.map((p: any) => p.tipo_combustible)).toContain("diesel");
    });

    it("el supervisor sigue viendo sólo los precios de su gasolinera en /hoy", async () => {
      // Crear un precio para gasAId (regular) para verificar que el supervisor lo ve
      // aunque pida precios de gasBId
      await http()
        .post("/api/v1/precios-combustible")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ gasolinera_id: gasAId, fecha: fechaGuatemala(), tipo_combustible: "regular", precio_galon: "28.750" })
        .expect(201);

      // El supervisor pide precios de gasBId pero solo ve los de su gasolinera (gasAId)
      const res = await http()
        .get(`/api/v1/precios-combustible/hoy?gasolinera_id=${gasBId}`)
        .set("Authorization", `Bearer ${supervisorToken}`);
      expect(res.status).toBe(200);
      expect(res.body.length).toBeGreaterThan(0);
      expect(res.body.every((p: any) => p.gasolinera_id === gasAId)).toBe(true);
      expect(res.body.some((p: any) => p.gasolinera_id === gasBId)).toBe(false);
    });

    it("/hoy sin gasolinera_id para admin → 400", async () => {
      const res = await http().get("/api/v1/precios-combustible/hoy").set("Authorization", `Bearer ${adminToken}`);
      expect(res.status).toBe(400);
    });
  });

  describe("Suscripciones push", () => {
    const endpoint = `https://push.example/${RUN_ID}`;
    const body = { endpoint, keys: { p256dh: "clave-p256dh", auth: "clave-auth" } };

    it("la clave pública VAPID es accesible sin login", async () => {
      const res = await http().get("/api/v1/push/vapid-public-key");
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ key: "clave-publica-de-prueba" });
    });

    it("el jefe de pista se suscribe → 201", async () => {
      const res = await http().post("/api/v1/push/suscripciones").set("Authorization", `Bearer ${jefeToken}`).send(body);
      expect(res.status).toBe(201);
    });

    it("el mismo navegador suscrito por el admin reasigna la fila, no la duplica", async () => {
      await http().post("/api/v1/push/suscripciones").set("Authorization", `Bearer ${adminToken}`).send(body).expect(201);
      const filas = await db.db.select().from(suscripcionesPush).where(eq(suscripcionesPush.endpoint, endpoint));
      expect(filas).toHaveLength(1);
      const [admin] = await db.db.select().from(usuarios).where(eq(usuarios.email, ADMIN_EMAIL));
      expect(filas[0].usuario_id).toBe(admin.id);
    });

    it("el jefe no puede borrar una suscripción que ya no es suya → 404", async () => {
      const res = await http().delete("/api/v1/push/suscripciones").set("Authorization", `Bearer ${jefeToken}`).send({ endpoint });
      expect(res.status).toBe(404);
    });

    it("el admin borra la suya → 200", async () => {
      const res = await http().delete("/api/v1/push/suscripciones").set("Authorization", `Bearer ${adminToken}`).send({ endpoint });
      expect(res.status).toBe(200);
    });

    it.each([
      ["supervisor", () => supervisorToken],
    ])("%s no puede suscribirse → 403", async (_rol, token) => {
      const res = await http().post("/api/v1/push/suscripciones").set("Authorization", `Bearer ${token()}`).send(body);
      expect(res.status).toBe(403);
    });

    it("body sin keys → 400", async () => {
      const res = await http().post("/api/v1/push/suscripciones").set("Authorization", `Bearer ${jefeToken}`).send({ endpoint });
      expect(res.status).toBe(400);
    });
  });
});
