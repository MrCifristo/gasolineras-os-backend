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
import { and, eq, inArray, like, ne } from "drizzle-orm";
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
import { RecordatoriosService } from "../src/modules/turnos/recordatorios.service";
import { clientes, gasolineras, recordatoriosTurno, suscripcionesPush, turnosGasolinera, usuarios } from "../src/db/schema";
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

    it("GET /turnos/actual con gasolinera_id que no es UUID → 400", async () => {
      const res = await http()
        .get("/api/v1/turnos/actual?gasolinera_id=abc")
        .set("Authorization", `Bearer ${adminToken}`);
      expect(res.status).toBe(400);
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

  describe("Permisos de lectura del cliente", () => {
    let clienteToken: string;
    let clienteId: string;

    beforeAll(async () => {
      const [c] = await db.db
        .insert(clientes)
        .values({ nombre: `[F6-${RUN_ID}] Cliente catálogo` })
        .returning();
      clienteId = c.id;
      const u = await crearUsuario("cliente", { cliente_id: clienteId });
      clienteToken = await loginToken(u.email!);
    });

    afterAll(async () => {
      await db.db.update(clientes).set({ activo: false }).where(eq(clientes.id, clienteId)).catch(() => undefined);
    });

    const auth = () => ({ Authorization: `Bearer ${clienteToken}` });

    it("lee la lista de gasolineras (arreglo, no objeto)", async () => {
      const res = await http().get("/api/v1/gasolineras").set(auth());
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.some((g: any) => g.id === gasAId)).toBe(true);
    });

    it("lee una gasolinera por id", async () => {
      const res = await http().get(`/api/v1/gasolineras/${gasBId}`).set(auth());
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(gasBId);
    });

    it("lee precios por gasolinera", async () => {
      const res = await http().get(`/api/v1/precios-combustible?gasolinera_id=${gasBId}`).set(auth());
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it("/hoy con gasolinera_id responde 200 y sin él 400", async () => {
      const ok = await http().get(`/api/v1/precios-combustible/hoy?gasolinera_id=${gasBId}`).set(auth());
      expect(ok.status).toBe(200);
      const sin = await http().get("/api/v1/precios-combustible/hoy").set(auth());
      expect(sin.status).toBe(400);
    });

    it("sigue sin poder crear ni editar precios ni gasolineras", async () => {
      const body = { gasolinera_id: gasBId, fecha: fechaGuatemala(), tipo_combustible: "regular", precio_galon: "29.000" };
      expect((await http().post("/api/v1/precios-combustible").set(auth()).send(body)).status).toBe(403);
      expect((await http().patch(`/api/v1/precios-combustible/${gasBId}`).set(auth()).send({ precio_galon: "1.000" })).status).toBe(403);
      expect((await http().post("/api/v1/gasolineras").set(auth()).send({ nombre: "x", direccion: "y", ciudad: "z" })).status).toBe(403);
      expect((await http().get(`/api/v1/gasolineras/${gasBId}/turnos`).set(auth())).status).toBe(403);
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

    it("endpoint sin esquema → 400", async () => {
      const res = await http().post("/api/v1/push/suscripciones").set("Authorization", `Bearer ${jefeToken}`)
        .send({ endpoint: "push.example.com/abc", keys: body.keys });
      expect(res.status).toBe(400);
    });

    it("expirationTime null (toJSON del navegador) se acepta → 201", async () => {
      const res = await http().post("/api/v1/push/suscripciones").set("Authorization", `Bearer ${jefeToken}`)
        .send({ ...body, expirationTime: null });
      expect(res.status).toBe(201);
    });

    it("body sin keys → 400", async () => {
      const res = await http().post("/api/v1/push/suscripciones").set("Authorization", `Bearer ${jefeToken}`).send({ endpoint });
      expect(res.status).toBe(400);
    });
  });

  describe("Recordatorios", () => {
    let recordatorios: RecordatoriosService;
    // Gasolinera propia para no depender del horario que dejaron los tests de turnos.
    let gasRId: string;
    const instante = (fechaGt: string, hhmmGt: string) =>
      new Date(new Date(`${fechaGt}T${hhmmGt}:00Z`).getTime() + 6 * 3600 * 1000);

    let turnosActivosPrevios: string[] = [];

    beforeAll(async () => {
      recordatorios = app.get(RecordatoriosService);
      const res = await http()
        .post("/api/v1/gasolineras")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ nombre: `[F6-${RUN_ID}] Estación R`, direccion: "Km 1", ciudad: "Morales" });
      gasRId = res.body.id;
      // Sólo esta gasolinera tiene recordatorio: aislamos de otras de la BD.
      const activos = await db.db
        .select({ id: turnosGasolinera.id })
        .from(turnosGasolinera)
        .where(and(eq(turnosGasolinera.recordatorio_activo, true), ne(turnosGasolinera.gasolinera_id, gasRId)));
      turnosActivosPrevios = activos.map((t) => t.id);
      if (turnosActivosPrevios.length) {
        await db.db
          .update(turnosGasolinera)
          .set({ recordatorio_activo: false })
          .where(inArray(turnosGasolinera.id, turnosActivosPrevios));
      }
      await db.db
        .update(turnosGasolinera)
        .set({ recordatorio_activo: true })
        .where(eq(turnosGasolinera.gasolinera_id, gasRId));
    });

    afterAll(async () => {
      // Restaurar el flag del resto de gasolineras de la BD de desarrollo.
      if (turnosActivosPrevios.length) {
        await db.db
          .update(turnosGasolinera)
          .set({ recordatorio_activo: true })
          .where(inArray(turnosGasolinera.id, turnosActivosPrevios));
      }
      await db.db.update(gasolineras).set({ activo: false }).where(eq(gasolineras.id, gasRId));
    });

    beforeEach(() => {
      correos.limpiar();
      pushes.limpiar();
    });

    it("fuera de la ventana no envía nada", async () => {
      const r = await recordatorios.ejecutar(instante("2030-01-10", "12:00"));
      expect(r.enviados).toHaveLength(0);
    });

    it("dentro de la ventana envía una vez por destinatario y es idempotente", async () => {
      // El jefe de pista tiene suscripción push.
      await http()
        .post("/api/v1/push/suscripciones")
        .set("Authorization", `Bearer ${jefeToken}`)
        .send({ endpoint: `https://push.example/jefe-${RUN_ID}`, keys: { p256dh: "p", auth: "a" } })
        .expect(201);

      const ahora = instante("2030-01-11", "13:45");
      const primera = await recordatorios.ejecutar(ahora);
      const segunda = await recordatorios.ejecutar(ahora);

      expect(primera.enviados).toEqual([
        expect.objectContaining({ gasolinera_id: gasRId, turno: "tarde", fecha: "2030-01-11" }),
      ]);
      expect(segunda.enviados).toHaveLength(0);

      const filas = await db.db
        .select()
        .from(recordatoriosTurno)
        .where(and(eq(recordatoriosTurno.gasolinera_id, gasRId), eq(recordatoriosTurno.fecha, "2030-01-11")));
      expect(filas).toHaveLength(1);

      const paraJefe = pushes.enviados.filter((p) => p.destino.endpoint === `https://push.example/jefe-${RUN_ID}`);
      expect(paraJefe).toHaveLength(1);
      expect(paraJefe[0].mensaje.url).toBe("/jefe");
      expect(correos.enviados.length).toBe(filas[0].correos_enviados);
      expect(correos.enviados[0].asunto).toContain("Turno Tarde");
    });

    it("sin precios del día, el mensaje lo dice", async () => {
      await recordatorios.ejecutar(instante("2030-01-12", "13:45"));
      expect(correos.enviados[0].texto).toContain("Todavía no hay precios cargados para hoy");
    });

    it("con precios del día GT, el mensaje los incluye", async () => {
      await http()
        .post("/api/v1/precios-combustible")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ gasolinera_id: gasRId, fecha: "2030-01-13", tipo_combustible: "super", precio_galon: "34.750" })
        .expect(201);
      await recordatorios.ejecutar(instante("2030-01-13", "13:45"));
      expect(correos.enviados[0].texto).toContain("Súper: Q 34.750");
    });

    it("turno que empieza a las 00:15: el aviso de las 23:50 GT (05:50 UTC) lleva la fecha GT del día siguiente y sus precios", async () => {
      const poner = (fecha: string, tipo: string, precio: string) =>
        http()
          .post("/api/v1/precios-combustible")
          .set("Authorization", `Bearer ${adminToken}`)
          .send({ gasolinera_id: gasRId, fecha, tipo_combustible: tipo, precio_galon: precio })
          .expect(201);
      await poner("2030-01-15", "diesel", "31.250");
      await poner("2030-01-14", "regular", "29.000");
      await db.db
        .update(turnosGasolinera)
        .set({ hora_inicio: "00:15", hora_fin: "06:00" })
        .where(and(eq(turnosGasolinera.gasolinera_id, gasRId), eq(turnosGasolinera.turno, "manana")));
      await db.db
        .update(turnosGasolinera)
        .set({ hora_inicio: "06:00", hora_fin: "00:15" })
        .where(and(eq(turnosGasolinera.gasolinera_id, gasRId), eq(turnosGasolinera.turno, "tarde")));
      try {
        const r = await recordatorios.ejecutar(instante("2030-01-14", "23:50"));
        expect(r.enviados).toEqual([expect.objectContaining({ turno: "manana", fecha: "2030-01-15" })]);
        expect(correos.enviados.length).toBeGreaterThan(0);
        expect(correos.enviados[0].texto).toContain("Diésel: Q 31.250");
        expect(correos.enviados[0].texto).not.toContain("Regular");
      } finally {
        // Restaurar horario por defecto aunque falle una aserción
        await db.db.update(turnosGasolinera).set({ hora_inicio: "06:00", hora_fin: "14:00" })
          .where(and(eq(turnosGasolinera.gasolinera_id, gasRId), eq(turnosGasolinera.turno, "manana")));
        await db.db.update(turnosGasolinera).set({ hora_inicio: "14:00", hora_fin: "22:00" })
          .where(and(eq(turnosGasolinera.gasolinera_id, gasRId), eq(turnosGasolinera.turno, "tarde")));
      }
    });

    it("un admin sin email no rompe el envío y un jefe inactivo no recibe nada", async () => {
      await crearUsuario("admin", { email: null, telefono: `5${RUN_ID}01` });
      const inactivo = await crearUsuario("jefe_pista", { activo: false });
      await recordatorios.ejecutar(instante("2030-01-16", "13:45"));
      expect(correos.enviados.length).toBeGreaterThan(0);
      expect(correos.enviados.some((m) => m.para === inactivo.email)).toBe(false);
    });

    it("una gasolinera bloqueada no recibe recordatorios", async () => {
      await db.db.update(gasolineras).set({ bloqueado: true }).where(eq(gasolineras.id, gasRId));
      try {
        const r = await recordatorios.ejecutar(instante("2030-01-17", "13:45"));
        expect(r.enviados).toHaveLength(0);
      } finally {
        await db.db.update(gasolineras).set({ bloqueado: false }).where(eq(gasolineras.id, gasRId));
      }
    });

    it("una suscripción que responde 410 se elimina", async () => {
      const endpoint = `https://push.example/muerta-${RUN_ID}`;
      await http()
        .post("/api/v1/push/suscripciones")
        .set("Authorization", `Bearer ${jefeToken}`)
        .send({ endpoint, keys: { p256dh: "p", auth: "a" } })
        .expect(201);
      pushes.expirados.add(endpoint);
      await recordatorios.ejecutar(instante("2030-01-18", "13:45"));
      const filas = await db.db.select().from(suscripcionesPush).where(eq(suscripcionesPush.endpoint, endpoint));
      expect(filas).toHaveLength(0);
    });
  });

  describe("Restricciones de vehículo", () => {
    let clienteToken: string;
    let clienteId: string;
    let otroClienteId: string;
    let vehPropioId: string;
    let vehAjenoId: string;

    beforeAll(async () => {
      const [c1, c2] = await db.db
        .insert(clientes)
        .values([
          { nombre: `[F6-${RUN_ID}] Cliente restricciones` },
          { nombre: `[F6-${RUN_ID}] Otro cliente restricciones` },
        ])
        .returning();
      clienteId = c1.id;
      otroClienteId = c2.id;
      const u = await crearUsuario("cliente", { cliente_id: clienteId });
      clienteToken = await loginToken(u.email!);
      for (const [cid, placa] of [
        [clienteId, `RP${RUN_ID}`],
        [otroClienteId, `RA${RUN_ID}`],
      ]) {
        const res = await http()
          .post("/api/v1/vehiculos")
          .set("Authorization", `Bearer ${adminToken}`)
          .send({ cliente_id: cid, placa });
        expect(res.status).toBe(201);
        if (cid === clienteId) vehPropioId = res.body.id;
        else vehAjenoId = res.body.id;
      }
    });

    afterAll(async () => {
      for (const id of [clienteId, otroClienteId]) {
        await db.db.update(clientes).set({ activo: false }).where(eq(clientes.id, id)).catch(() => undefined);
      }
    });

    const patch = (id: string, token: string, body: object) =>
      http().patch(`/api/v1/vehiculos/${id}/restricciones`).set("Authorization", `Bearer ${token}`).send(body);

    it("el admin edita las restricciones de cualquier vehículo", async () => {
      const res = await patch(vehAjenoId, adminToken, { bloqueado: true, limite_monto_dia: 500 });
      expect(res.status).toBe(200);
      expect(res.body.bloqueado).toBe(true);
      expect(Number(res.body.limite_monto_dia)).toBe(500);
    });

    it("el cliente edita las de un vehículo suyo y persisten", async () => {
      const res = await patch(vehPropioId, clienteToken, {
        limite_trans_dia: 3,
        productos_permitidos: ["diesel"],
        dias_permitidos: ["lunes"],
        hora_inicio: "06:00",
        hora_fin: "18:30",
        limite_volumen_mes: 120.5,
      });
      expect(res.status).toBe(200);
      const get = await http().get(`/api/v1/vehiculos/${vehPropioId}`).set("Authorization", `Bearer ${clienteToken}`);
      expect(get.status).toBe(200);
      expect(get.body).toEqual(
        expect.objectContaining({
          limite_trans_dia: 3,
          productos_permitidos: ["diesel"],
          dias_permitidos: ["lunes"],
          hora_inicio: "06:00",
          hora_fin: "18:30",
        }),
      );
      expect(Number(get.body.limite_volumen_mes)).toBe(120.5);
    });

    it("null limpia un límite", async () => {
      await patch(vehPropioId, clienteToken, { limite_monto_dia: 200 }).expect(200);
      const res = await patch(vehPropioId, clienteToken, { limite_monto_dia: null, hora_inicio: null });
      expect(res.status).toBe(200);
      expect(res.body.limite_monto_dia).toBeNull();
      expect(res.body.hora_inicio).toBeNull();
    });

    it("el cliente no toca un vehículo ajeno: 404 y no cambia", async () => {
      const antes = await db.db.query.vehiculos.findFirst({ where: (v, { eq }) => eq(v.id, vehAjenoId) });
      const res = await patch(vehAjenoId, clienteToken, { bloqueado: false });
      expect(res.status).toBe(404);
      expect(res.body.message).toBe("Vehículo no encontrado");
      const despues = await db.db.query.vehiculos.findFirst({ where: (v, { eq }) => eq(v.id, vehAjenoId) });
      expect(despues?.bloqueado).toBe(antes?.bloqueado);
    });

    it("un vehículo inexistente da 404", async () => {
      const res = await patch("00000000-0000-4000-8000-000000000000", clienteToken, { bloqueado: true });
      expect(res.status).toBe(404);
    });

    it("el supervisor recibe 403", async () => {
      const res = await patch(vehPropioId, supervisorToken, { bloqueado: true });
      expect(res.status).toBe(403);
    });

    it("un campo que no es restricción da 400", async () => {
      const res = await patch(vehPropioId, clienteToken, { placa: "HACK1" });
      expect(res.status).toBe(400);
    });

    it("el cliente bloquea su vehículo (200) pero no lo desbloquea (403) y el admin sí (200)", async () => {
      const bloquea = await patch(vehPropioId, clienteToken, { bloqueado: true });
      expect(bloquea.status).toBe(200);
      expect(bloquea.body.bloqueado).toBe(true);

      const desbloquea = await patch(vehPropioId, clienteToken, {
        bloqueado: false,
        limite_monto_dia: 999,
      });
      expect(desbloquea.status).toBe(403);
      expect(desbloquea.body.message).toBe("Sólo la estación puede desbloquear un vehículo.");
      const tras = await http().get(`/api/v1/vehiculos/${vehPropioId}`).set("Authorization", `Bearer ${clienteToken}`);
      expect(tras.body.bloqueado).toBe(true);
      expect(Number(tras.body.limite_monto_dia ?? 0)).not.toBe(999);

      const ajeno = await patch(vehAjenoId, clienteToken, { bloqueado: false });
      expect(ajeno.status).toBe(404);

      const admin = await patch(vehPropioId, adminToken, { bloqueado: false });
      expect(admin.status).toBe(200);
      expect(admin.body.bloqueado).toBe(false);
    });

    it("bloqueado: null da 400, no 500", async () => {
      const res = await patch(vehPropioId, clienteToken, { bloqueado: null });
      expect(res.status).toBe(400);
      const g = await http()
        .patch(`/api/v1/vehiculos/${vehPropioId}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ bloqueado: null });
      expect(g.status).toBe(400);
    });

    it("hora_inicio mal formada da 400", async () => {
      const res = await patch(vehPropioId, clienteToken, { hora_inicio: "25:99" });
      expect(res.status).toBe(400);
    });

    it("el cliente sigue sin poder editar el vehículo en general", async () => {
      const res = await http()
        .patch(`/api/v1/vehiculos/${vehPropioId}`)
        .set("Authorization", `Bearer ${clienteToken}`)
        .send({ marca: "X" });
      expect(res.status).toBe(403);
    });

    describe("alcance del cliente (IDOR)", () => {
      let pilPropioId: string;
      let pilAjenoId: string;
      const auth = () => ({ Authorization: `Bearer ${clienteToken}` });

      beforeAll(async () => {
        for (const cid of [clienteId, otroClienteId]) {
          const res = await http()
            .post("/api/v1/pilotos")
            .set("Authorization", `Bearer ${adminToken}`)
            .send({ cliente_id: cid, nombre_completo: `Piloto ${RUN_ID}` });
          expect(res.status).toBe(201);
          if (cid === clienteId) pilPropioId = res.body.id;
          else pilAjenoId = res.body.id;
        }
      });

      it("GET /vehiculos sólo devuelve los propios, aunque pida otro cliente_id", async () => {
        for (const q of ["", `?cliente_id=${otroClienteId}`]) {
          const res = await http().get(`/api/v1/vehiculos${q}`).set(auth());
          expect(res.status).toBe(200);
          expect(res.body.map((v: any) => v.id)).toEqual([vehPropioId]);
        }
      });

      it("GET /vehiculos/:id de otro cliente da 404; el propio da 200", async () => {
        const ajeno = await http().get(`/api/v1/vehiculos/${vehAjenoId}`).set(auth());
        expect(ajeno.status).toBe(404);
        expect(ajeno.body.message).toBe("Vehículo no encontrado");
        await http().get(`/api/v1/vehiculos/${vehPropioId}`).set(auth()).expect(200);
      });

      it("el admin sigue viendo vehículos de cualquier cliente", async () => {
        const res = await http()
          .get(`/api/v1/vehiculos?cliente_id=${otroClienteId}`)
          .set("Authorization", `Bearer ${adminToken}`);
        expect(res.body.map((v: any) => v.id)).toEqual([vehAjenoId]);
      });

      it("GET /pilotos sólo devuelve los propios", async () => {
        for (const q of ["", `?cliente_id=${otroClienteId}`]) {
          const res = await http().get(`/api/v1/pilotos${q}`).set(auth());
          expect(res.status).toBe(200);
          expect(res.body.map((p: any) => p.id)).toEqual([pilPropioId]);
        }
      });

      it("GET /pilotos/:id de otro cliente da 404", async () => {
        const ajeno = await http().get(`/api/v1/pilotos/${pilAjenoId}`).set(auth());
        expect(ajeno.status).toBe(404);
        await http().get(`/api/v1/pilotos/${pilPropioId}`).set(auth()).expect(200);
      });

      it("GET /clientes sólo devuelve el propio", async () => {
        const res = await http().get("/api/v1/clientes").set(auth());
        expect(res.status).toBe(200);
        expect(res.body.map((c: any) => c.id)).toEqual([clienteId]);
      });

      it("GET /clientes/:id de otro cliente da 404", async () => {
        const ajeno = await http().get(`/api/v1/clientes/${otroClienteId}`).set(auth());
        expect(ajeno.status).toBe(404);
        await http().get(`/api/v1/clientes/${clienteId}`).set(auth()).expect(200);
      });

      it("consumo-hoy de un vehículo ajeno da 404", async () => {
        const ajeno = await http().get(`/api/v1/despachos/vehiculo/${vehAjenoId}/consumo-hoy`).set(auth());
        expect(ajeno.status).toBe(404);
        await http().get(`/api/v1/despachos/vehiculo/${vehPropioId}/consumo-hoy`).set(auth()).expect(200);
      });

      it("consumo-hoy de un vehículo propio ignora el cliente_id del query", async () => {
        const [base, forzado] = await Promise.all([
          http().get(`/api/v1/despachos/vehiculo/${vehPropioId}/consumo-hoy`).set(auth()),
          http().get(`/api/v1/despachos/vehiculo/${vehPropioId}/consumo-hoy?cliente_id=${otroClienteId}`).set(auth()),
        ]);
        expect(forzado.status).toBe(200);
        expect(forzado.body).toEqual(base.body);
      });

      it("un cliente sin empresa asignada recibe listas vacías de despachos", async () => {
        const u = await crearUsuario("cliente");
        const token = await loginToken(u.email!);
        const res = await http().get("/api/v1/despachos").set("Authorization", `Bearer ${token}`);
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ data: [], total: 0, page: 1, limit: 20 });
        const v = await http().get("/api/v1/ventas-insumos").set("Authorization", `Bearer ${token}`);
        expect(v.status).toBe(200);
        expect(v.body).toEqual([]);
      });

      it("reportes ignoran el cliente_id del query", async () => {
        const [propio, forzado] = await Promise.all([
          http().get("/api/v1/reportes/resumen").set(auth()),
          http().get(`/api/v1/reportes/resumen?cliente_id=${otroClienteId}`).set(auth()),
        ]);
        expect(propio.status).toBe(200);
        expect(forzado.body).toEqual(propio.body);
        for (const ruta of ["consumo-por-vehiculo", "consumo-por-piloto", "tendencia-mensual"]) {
          const a = await http().get(`/api/v1/reportes/${ruta}`).set(auth());
          const b = await http().get(`/api/v1/reportes/${ruta}?cliente_id=${otroClienteId}`).set(auth());
          expect(b.status).toBe(200);
          expect(b.body).toEqual(a.body);
        }
      });

      it("rendimiento-vehiculo de un vehículo ajeno no devuelve filas", async () => {
        const res = await http().get(`/api/v1/reportes/rendimiento-vehiculo/${vehAjenoId}`).set(auth());
        expect(res.status).toBe(200);
        expect(res.body).toEqual([]);
      });
    });
  });
});
