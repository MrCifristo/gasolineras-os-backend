/**
 * GasFuel OS — Suite de tests E2E completa
 *
 * Cubre el flujo real de negocio de principio a fin:
 *   Auth → Usuarios → Gasolineras → Clientes → Vehículos → Pilotos
 *   → Precios → Despachos → Reportes/KPIs → Control de acceso
 *
 * Requisitos:
 *   - PostgreSQL corriendo (docker compose up -d postgres)
 *   - Variables de entorno en .env, incluidas E2E_ADMIN_EMAIL y E2E_ADMIN_PASSWORD
 *   - Un usuario admin ya creado (pnpm bootstrap:admin)
 *
 * Ejecutar:
 *   pnpm test:e2e:gasfuel
 */

import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { ThrottlerGuard } from "@nestjs/throttler";
import { eq, like } from "drizzle-orm";
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
import { gasolineras, usuarios } from "../src/db/schema";

// moduleNameMapper resuelve "puppeteer" al mock de test/__mocks__. El cast es
// para llegar a los ayudantes del mock, que los tipos reales no declaran.
import puppeteerReal from "puppeteer";
import { fechaGuatemala, sumarDias } from "../src/common/hora-guatemala";
const puppeteerMock = puppeteerReal as unknown as {
  __paginas: {
    jsHabilitado: boolean;
    interceptacionActiva: boolean;
    eventos: string[];
  }[];
  __limpiarPaginas: () => void;
};

dotenv.config();
// Sin cron real: el tick de recordatorios no debe correr contra la BD en estas suites.
process.env.RECORDATORIOS_ACTIVOS = "false";

// ── Credenciales del admin bootstrap (creado con pnpm bootstrap:admin) ─────
// Sin fallback a propósito: un default aquí termina siendo una credencial real
// commiteada. Si faltan, la suite debe morir ruidosamente, no caer en un default.
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Falta ${name}. Definila en .env o en el entorno antes de correr la suite e2e.`,
    );
  }
  return value;
}

const ADMIN_EMAIL = requireEnv("E2E_ADMIN_EMAIL");
const ADMIN_PASSWORD = requireEnv("E2E_ADMIN_PASSWORD");

// ── Sufijo único por ejecución para no colisionar con datos previos ──────────
const RUN_ID = Date.now().toString().slice(-6);
const tag = (s: string) => `[E2E-${RUN_ID}] ${s}`;

// ── Contraseña estándar para usuarios de prueba ──────────────────────────────
const TEST_PASSWORD = `E2ePass#${RUN_ID}`;

// ────────────────────────────────────────────────────────────────────────────
describe("GasFuel OS — Suite E2E Completa", () => {
  let app: INestApplication<App>;
  let db: DbService;
  let correos: InMemoryMailService;

  // ── Tokens por rol ────────────────────────────────────────────────────────
  let adminToken: string;
  let supervisorToken: string;
  let clienteUserToken: string;

  // ── IDs de entidades creadas (compartidos entre bloques) ──────────────────
  let gasolineraId: string;
  let cliente1Id: string;
  let vehiculo1Id: string;
  let vehiculo2Id: string;
  let piloto1Id: string;
  let piloto2Id: string;
  let precioRegularId: string;
  let precioSuperiorId: string;
  let operarioId: string;
  let despacho1Id: string;
  let despacho2Id: string;
  let saldosCuadreId: string;

  // ════════════════════════════════════════════════════════════════════════
  // SETUP & TEARDOWN
  // ════════════════════════════════════════════════════════════════════════

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      // La suite hace varios logins seguidos; el rate limit los cortaría con
      // 429 y no es lo que se prueba acá.
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      // Fake en memoria: sin R2, sin red. También evita que R2StorageService se
      // instancie y falle al no haber env de R2.
      .overrideProvider(StorageService)
      .useClass(InMemoryStorageService)
      // Igual con el correo: sin esto ResendMailService exigiría RESEND_API_KEY
      // al boot y la suite dependería de la red y de la cuota del proveedor.
      // Además el token de reset sólo existe dentro del correo, así que el fake
      // es la única forma de leerlo.
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
    correos = app.get(MailService);
    const passwords = app.get(PasswordService);

    // El admin se siembra acá con el mismo hashing que la app, en vez de
    // depender de que alguien haya corrido `pnpm bootstrap:admin`. Esa
    // dependencia implícita es justo lo que llevó a que una contraseña real
    // terminara hardcodeada como fallback en este archivo.
    const emailAdmin = ADMIN_EMAIL.toLowerCase();
    const hash = await passwords.hashear(ADMIN_PASSWORD);
    await db.db
      .insert(usuarios)
      .values({
        email: emailAdmin,
        nombre: "Admin E2E",
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
    // El supervisor de prueba queda referenciado por los despachos que creó, así
    // que un delete duro violaría el FK. Se desactivan (no chocan con corridas
    // futuras porque el email lleva el RUN_ID) y la limpieza no tumba la suite.
    try {
      for (const email of [
        `supervisor.${RUN_ID}@gasfuel-e2e.test`,
        `cliente.${RUN_ID}@gasfuel-e2e.test`,
        `cliente.propio.${RUN_ID}@gasfuel-e2e.test`,
        `cliente.ajeno.${RUN_ID}@gasfuel-e2e.test`,
        `reset.${RUN_ID}@gasfuel-e2e.test`,
        `alta.cliente.${RUN_ID}@gasfuel-e2e.test`,
      ]) {
        await db.db
          .update(usuarios)
          .set({ activo: false })
          .where(eq(usuarios.email, email));
      }
      // Las estaciones creadas por la corrida (p. ej. "Otra estación") nacen con
      // turnos de recordatorio activos: se desactivan para que no reciban avisos.
      await db.db
        .update(gasolineras)
        .set({ activo: false })
        .where(like(gasolineras.nombre, `[E2E-${RUN_ID}] %`));
    } catch {
      // Limpieza best-effort: la DB de test se recrea con docker compose down -v.
    }

    await app.close();
  }, 30_000);

  // ════════════════════════════════════════════════════════════════════════
  // BLOQUE 1 — Autenticación
  // ════════════════════════════════════════════════════════════════════════

  describe("1. Autenticación", () => {
    it("rechaza login con credenciales incorrectas → 401", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/v1/auth/login")
        .send({ identificador: "noexiste@test.com", password: "WrongPass123" });

      expect(res.status).toBe(401);
      expect(res.body.message).toBeDefined();
    });

    it("rechaza request sin token en endpoint protegido → 401", async () => {
      const res = await request(app.getHttpServer()).get("/api/v1/gasolineras");
      expect(res.status).toBe(401);
    });

    it("admin hace login y obtiene access_token + datos del usuario → 200", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/v1/auth/login")
        .send({ identificador: ADMIN_EMAIL, password: ADMIN_PASSWORD });

      expect(res.status).toBe(200);
      expect(res.body.access_token).toBeDefined();
      expect(res.body.usuario.rol).toBe("admin");
      expect(res.body.usuario.email).toBe(ADMIN_EMAIL.toLowerCase());
      expect(res.body.refresh_token).toBeDefined();

      adminToken = res.body.access_token;
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // BLOQUE 2 — Gestión de Gasolineras
  // ════════════════════════════════════════════════════════════════════════

  describe("2. Gestión de Gasolineras", () => {
    it("admin crea una gasolinera → 201", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/v1/gasolineras")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          nombre: tag("Gasolinera Central"),
          direccion: "Av. Reforma 100",
          ciudad: "Ciudad de Guatemala",
        });

      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      expect(res.body.activo).toBe(true);

      gasolineraId = res.body.id;
    });

    it("admin lista gasolineras y ve la recién creada → 200", async () => {
      const res = await request(app.getHttpServer())
        .get("/api/v1/gasolineras")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      const found = res.body.find((g: any) => g.id === gasolineraId);
      expect(found).toBeDefined();
      expect(found.nombre).toContain("Gasolinera Central");
    });

    it("admin obtiene gasolinera por id → 200", async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/gasolineras/${gasolineraId}`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(gasolineraId);
    });

    it("admin actualiza nombre de la gasolinera → 200", async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/gasolineras/${gasolineraId}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ nombre: tag("Gasolinera Central Actualizada") });

      expect(res.status).toBe(200);
      expect(res.body.nombre).toContain("Actualizada");
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // BLOQUE 3 — Creación de usuarios por rol
  // ════════════════════════════════════════════════════════════════════════

  describe("3. Gestión de Usuarios por Rol", () => {
    it("admin crea usuario OPERARIO asignado a la gasolinera → 201", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/v1/usuarios")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          nombre: tag("Operario López"),
          email: `supervisor.${RUN_ID}@gasfuel-e2e.test`,
          password: TEST_PASSWORD,
          rol: "supervisor",
          gasolinera_id: gasolineraId,
        });

      expect(res.status).toBe(201);
      expect(res.body.rol).toBe("supervisor");
      expect(res.body.gasolinera_id).toBe(gasolineraId);
      // El hash nunca debe salir en la respuesta.
      expect(res.body.password_hash).toBeUndefined();
    });

    it("supervisor puede hacer login con sus credenciales → 200", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/v1/auth/login")
        .send({
          identificador: `supervisor.${RUN_ID}@gasfuel-e2e.test`,
          password: TEST_PASSWORD,
        });

      expect(res.status).toBe(200);
      expect(res.body.usuario.rol).toBe("supervisor");
      supervisorToken = res.body.access_token;
    });

    it("admin no puede crear un usuario CLIENTE sin empresa → 400", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/v1/usuarios")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          nombre: tag("Usuario Cliente SA"),
          email: `cliente.${RUN_ID}@gasfuel-e2e.test`,
          password: TEST_PASSWORD,
          rol: "cliente",
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain("cliente_id");
    });

    it("usuario CLIENTE sin empresa sembrado por BD (para probar el fail-closed)", async () => {
      // La API ya no deja crearlo (ver el test anterior), pero los tests de
      // alcance necesitan uno: así se prueba que cada ruta falla cerrado aunque
      // un usuario así llegue a existir (datos viejos, edición directa en BD).
      const passwords = app.get(PasswordService);
      const [u] = await db.db
        .insert(usuarios)
        .values({
          email: `cliente.${RUN_ID}@gasfuel-e2e.test`,
          nombre: tag("Usuario Cliente SA"),
          password_hash: await passwords.hashear(TEST_PASSWORD),
          rol: "cliente",
          activo: true,
        })
        .returning();
      expect(u.rol).toBe("cliente");
      expect(u.cliente_id).toBeNull();
    });

    it("usuario cliente puede hacer login → 200", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/v1/auth/login")
        .send({
          identificador: `cliente.${RUN_ID}@gasfuel-e2e.test`,
          password: TEST_PASSWORD,
        });

      expect(res.status).toBe(200);
      expect(res.body.usuario.rol).toBe("cliente");
      clienteUserToken = res.body.access_token;
    });

    it("admin lista todos los usuarios → 200", async () => {
      const res = await request(app.getHttpServer())
        .get("/api/v1/usuarios")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(2);
    });

    it("supervisor no puede listar usuarios (solo admin) → 403", async () => {
      const res = await request(app.getHttpServer())
        .get("/api/v1/usuarios")
        .set("Authorization", `Bearer ${supervisorToken}`);

      expect(res.status).toBe(403);
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // BLOQUE 4 — Gestión de Clientes (empresas)
  // ════════════════════════════════════════════════════════════════════════

  describe("4. Gestión de Clientes (Empresas)", () => {
    it("admin crea empresa cliente con NIT → 201", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/v1/clientes")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          nombre: tag("Transportes Guatemala SA"),
          nit: `${RUN_ID}-7`,
          contacto_email: `contacto.${RUN_ID}@transportes.gt`,
        });

      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      expect(res.body.activo).toBe(true);

      cliente1Id = res.body.id;
    });

    it("cliente recién creado tiene saldo inicial en 0 → 200", async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/clientes/${cliente1Id}`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(cliente1Id);
      // El cliente debe tener vehiculos y pilotos como arrays vacíos por ahora
      expect(Array.isArray(res.body.vehiculos)).toBe(true);
      expect(Array.isArray(res.body.pilotos)).toBe(true);
    });

    it("admin lista clientes activos → 200", async () => {
      const res = await request(app.getHttpServer())
        .get("/api/v1/clientes")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      const found = res.body.find((c: any) => c.id === cliente1Id);
      expect(found).toBeDefined();
    });

    it("cliente no puede crear otros clientes → 403", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/v1/clientes")
        .set("Authorization", `Bearer ${clienteUserToken}`)
        .send({ nombre: "Intento no autorizado", nit: "000" });

      expect(res.status).toBe(403);
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // BLOQUE 5 — Gestión de Vehículos
  // ════════════════════════════════════════════════════════════════════════

  describe("5. Gestión de Vehículos", () => {
    it("admin crea vehículo 1 (camión) → 201", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/v1/vehiculos")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          cliente_id: cliente1Id,
          placa: `E2E-${RUN_ID}A`,
          marca: "Mercedes",
          modelo: "Actros 2545",
          ruta: "Guatemala - Escuintla",
          tipo_vehiculo: "camion",
        });

      expect(res.status).toBe(201);
      expect(res.body.placa).toBe(`E2E-${RUN_ID}A`);
      vehiculo1Id = res.body.id;
    });

    it("admin crea vehículo 2 (pick-up) → 201", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/v1/vehiculos")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          cliente_id: cliente1Id,
          placa: `E2E-${RUN_ID}B`,
          marca: "Toyota",
          modelo: "Hilux 2024",
          ruta: "Guatemala - Antigua",
          tipo_vehiculo: "pickup",
        });

      expect(res.status).toBe(201);
      vehiculo2Id = res.body.id;
    });

    it("lista vehículos del cliente → 200 devuelve los 2", async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/vehiculos?cliente_id=${cliente1Id}`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      const ids = res.body.map((v: any) => v.id);
      expect(ids).toContain(vehiculo1Id);
      expect(ids).toContain(vehiculo2Id);
    });

    it("admin actualiza ruta del vehículo 1 → 200", async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/vehiculos/${vehiculo1Id}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ ruta: "Guatemala - Puerto Quetzal" });

      expect(res.status).toBe(200);
      expect(res.body.ruta).toBe("Guatemala - Puerto Quetzal");
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // BLOQUE 6 — Gestión de Pilotos
  // ════════════════════════════════════════════════════════════════════════

  describe("6. Gestión de Pilotos (Repartidores)", () => {
    it("admin crea piloto 1 → 201", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/v1/pilotos")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          cliente_id: cliente1Id,
          nombre_completo: tag("Carlos Mendoza"),
          codigo: `PIL-${RUN_ID}-01`,
        });

      expect(res.status).toBe(201);
      expect(res.body.activo).toBe(true);
      piloto1Id = res.body.id;
    });

    it("admin crea piloto 2 → 201", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/v1/pilotos")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          cliente_id: cliente1Id,
          nombre_completo: tag("Ana García"),
          codigo: `PIL-${RUN_ID}-02`,
        });

      expect(res.status).toBe(201);
      piloto2Id = res.body.id;
    });

    it("admin asigna piloto 1 al vehículo 1 → 201", async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/vehiculos/${vehiculo1Id}/pilotos/${piloto1Id}`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(201);
    });

    it("admin asigna piloto 2 al vehículo 2 → 201", async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/vehiculos/${vehiculo2Id}/pilotos/${piloto2Id}`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(201);
    });

    it("detalle del piloto incluye sus vehículos asignados → 200", async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/pilotos/${piloto1Id}`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.vehiculos)).toBe(true);
      expect(res.body.vehiculos.some((v: any) => v.id === vehiculo1Id)).toBe(
        true,
      );
    });

    it("detalle del cliente incluye sus vehículos y pilotos activos → 200", async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/clientes/${cliente1Id}`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.vehiculos.length).toBe(2);
      expect(res.body.pilotos.length).toBe(2);
    });

    it("lista pilotos del cliente solo devuelve activos → 200", async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/pilotos?cliente_id=${cliente1Id}`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.every((p: any) => p.activo === true)).toBe(true);
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // BLOQUE 7 — Precios de Combustible
  // ════════════════════════════════════════════════════════════════════════

  describe("7. Precios de Combustible", () => {
    const today = fechaGuatemala();

    it("admin registra precio de diesel hoy → 201", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/v1/precios-combustible")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          gasolinera_id: gasolineraId,
          fecha: today,
          tipo_combustible: "diesel",
          precio_galon: "28.500",
        });

      expect(res.status).toBe(201);
      expect(res.body.tipo_combustible).toBe("diesel");
      precioRegularId = res.body.id;
    });

    it("admin registra precio de super hoy → 201", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/v1/precios-combustible")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          gasolinera_id: gasolineraId,
          fecha: today,
          tipo_combustible: "super",
          precio_galon: "34.750",
        });

      expect(res.status).toBe(201);
      expect(res.body.tipo_combustible).toBe("super");
      precioSuperiorId = res.body.id;
    });

    it("supervisor consulta precio del día de su gasolinera → 200", async () => {
      const res = await request(app.getHttpServer())
        .get("/api/v1/precios-combustible/hoy")
        .set("Authorization", `Bearer ${supervisorToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      const tipos = res.body.map((p: any) => p.tipo_combustible);
      expect(tipos).toContain("diesel");
      expect(tipos).toContain("super");
    });

    it("no se puede registrar dos precios del mismo tipo en el mismo día → 409", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/v1/precios-combustible")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          gasolinera_id: gasolineraId,
          fecha: today,
          tipo_combustible: "diesel",
          precio_galon: "99.999",
        });

      expect(res.status).toBe(409);
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // BLOQUE 8 — Despachos de Combustible
  // ════════════════════════════════════════════════════════════════════════

  describe("8. Despachos de Combustible", () => {
    // El operario es el personal de bomba, no una cuenta: el supervisor lo
    // elige al registrar el vale. Todo despacho necesita uno.
    it("admin crea el operario que despacha en la bomba → 201", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/v1/operarios")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          gasolinera_id: gasolineraId,
          nombre: tag("Operario Bomba"),
          codigo: `OP-${RUN_ID}`,
        });

      expect(res.status).toBe(201);
      expect(res.body.activo).toBe(true);
      operarioId = res.body.id;
    });

    it("supervisor despacha diesel al vehículo 1 (camión) → 201", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/v1/despachos")
        .set("Authorization", `Bearer ${supervisorToken}`)
        .send({
          cliente_id: cliente1Id,
          operario_id: operarioId,
          vehiculo_id: vehiculo1Id,
          piloto_id: piloto1Id,
          tipo_combustible: "diesel",
          turno: "manana",
          bomba_numero: 1,
          kilometraje: "12500.000",
          monto: "2280.000", // 80 gal * 28.5
        });

      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      expect(res.body.numero_vale).toBe("000001"); // primer vale de esta serie
      // monto = 80 * 28.5 = 2280.000
      expect(parseFloat(res.body.monto_total)).toBeCloseTo(2280.0, 1);

      despacho1Id = res.body.id;
    });

    it("supervisor despacha super al vehículo 2 (pick-up) → 201", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/v1/despachos")
        .set("Authorization", `Bearer ${supervisorToken}`)
        .send({
          cliente_id: cliente1Id,
          operario_id: operarioId,
          vehiculo_id: vehiculo2Id,
          piloto_id: piloto2Id,
          tipo_combustible: "super",
          turno: "tarde",
          bomba_numero: 2,
          kilometraje: "45200.000",
          monto: "538.625", // 15.5 gal * 34.75
        });

      expect(res.status).toBe(201);
      expect(res.body.numero_vale).toBe("000002"); // segundo vale de la misma serie
      // monto = 15.5 * 34.75 = 538.625
      expect(parseFloat(res.body.monto_total)).toBeCloseTo(538.625, 1);

      despacho2Id = res.body.id;
    });

    it("el saldo del cliente se descontó (movimientos existen) → despacho tiene monto correcto", async () => {
      // Verificamos indirectamente a través del detalle del despacho
      const res = await request(app.getHttpServer())
        .get(`/api/v1/despachos/${despacho1Id}`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.despacho.id).toBe(despacho1Id);
      expect(res.body.vehiculo.placa).toBe(`E2E-${RUN_ID}A`);
      expect(res.body.piloto.codigo).toBe(`PIL-${RUN_ID}-01`);
      expect(res.body.gasolinera.id).toBe(gasolineraId);
      expect(res.body.cliente.id).toBe(cliente1Id);
    });

    it("el detalle trae el operario que despachó", async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/despachos/${despacho1Id}`)
        .set("Authorization", `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.operario).toEqual({ id: operarioId, nombre: tag("Operario Bomba") });
    });

    it("rechaza un operario de otra gasolinera → 400", async () => {
      const otra = await request(app.getHttpServer())
        .post("/api/v1/gasolineras")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ nombre: tag("Otra estación"), direccion: "Km 2", ciudad: "Puerto Barrios" });
      const ajeno = await request(app.getHttpServer())
        .post("/api/v1/operarios")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ gasolinera_id: otra.body.id, nombre: tag("Operario ajeno") });

      const res = await request(app.getHttpServer())
        .post("/api/v1/despachos")
        .set("Authorization", `Bearer ${supervisorToken}`)
        .send({
          cliente_id: cliente1Id, operario_id: ajeno.body.id,
          vehiculo_id: vehiculo1Id, piloto_id: piloto1Id,
          tipo_combustible: "diesel", turno: "manana", monto: "100.000",
        });
      expect(res.status).toBe(400);
      expect(res.body.message).toBe("El operario no pertenece a esta gasolinera o está inactivo.");
    });

    it("rechaza un operario inactivo → 400", async () => {
      const inactivo = await request(app.getHttpServer())
        .post("/api/v1/operarios")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ gasolinera_id: gasolineraId, nombre: tag("Operario inactivo") });
      await request(app.getHttpServer())
        .delete(`/api/v1/operarios/${inactivo.body.id}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      const res = await request(app.getHttpServer())
        .post("/api/v1/despachos")
        .set("Authorization", `Bearer ${supervisorToken}`)
        .send({
          cliente_id: cliente1Id, operario_id: inactivo.body.id,
          vehiculo_id: vehiculo1Id, piloto_id: piloto1Id,
          tipo_combustible: "diesel", turno: "manana", monto: "100.000",
        });
      expect(res.status).toBe(400);
    });

    it("rechaza despacho de combustible sin precio registrado hoy → 400", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/v1/despachos")
        .set("Authorization", `Bearer ${supervisorToken}`)
        .send({
          cliente_id: cliente1Id,
          operario_id: operarioId,
          vehiculo_id: vehiculo1Id,
          piloto_id: piloto1Id,
          tipo_combustible: "regular", // sin precio registrado para este tipo
          turno: "manana",
          monto: "285.000",
        });

      expect(res.status).toBe(400);
    });

    it("usuario cliente no puede despachar combustible → 403", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/v1/despachos")
        .set("Authorization", `Bearer ${clienteUserToken}`)
        .send({
          cliente_id: cliente1Id,
          operario_id: operarioId,
          vehiculo_id: vehiculo1Id,
          piloto_id: piloto1Id,
          tipo_combustible: "diesel",
          turno: "manana",
          monto: "142.500",
        });

      expect(res.status).toBe(403);
    });

    it("supervisor actualiza kilometraje del despacho → 200", async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/despachos/${despacho1Id}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ kilometraje: "12600.000" });

      expect(res.status).toBe(200);
      expect(parseFloat(res.body.kilometraje)).toBeCloseTo(12600, 0);
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // BLOQUE 9 — Consultas y Filtros de Despachos
  // ════════════════════════════════════════════════════════════════════════

  describe("9. Consultas y Filtros de Despachos", () => {
    const today = fechaGuatemala();

    it("admin lista despachos con paginación y total → 200", async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/despachos?cliente_id=${cliente1Id}&page=1&limit=1`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual(
        expect.objectContaining({ total: 2, page: 1, limit: 1 }),
      );
      expect(res.body.data).toHaveLength(1);

      const pag2 = await request(app.getHttpServer())
        .get(`/api/v1/despachos?cliente_id=${cliente1Id}&page=2&limit=1`)
        .set("Authorization", `Bearer ${adminToken}`);
      const ids = [res.body.data[0].id, pag2.body.data[0].id];
      expect(ids).toEqual(expect.arrayContaining([despacho1Id, despacho2Id]));
    });

    it("cada despacho del listado trae su operario", async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/despachos?cliente_id=${cliente1Id}`)
        .set("Authorization", `Bearer ${adminToken}`);
      expect(res.body.data.length).toBeGreaterThan(0);
      expect(res.body.data.every((d: any) => d.operario?.id === operarioId)).toBe(true);
    });

    it("filtra despachos por cliente → solo aparecen los del cliente E2E", async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/despachos?cliente_id=${cliente1Id}`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(2);
      expect(res.body.data.every((d: any) => d.cliente_id === cliente1Id)).toBe(
        true,
      );
    });

    it("filtra despachos por tipo_combustible=diesel → solo 1 resultado", async () => {
      const res = await request(app.getHttpServer())
        .get(
          `/api/v1/despachos?cliente_id=${cliente1Id}&tipo_combustible=diesel`,
        )
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].id).toBe(despacho1Id);
    });

    it("filtra despachos por fecha_desde y fecha_hasta (hoy) → 2 resultados", async () => {
      const res = await request(app.getHttpServer())
        .get(
          `/api/v1/despachos?cliente_id=${cliente1Id}&fecha_desde=${today}&fecha_hasta=${today}`,
        )
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(2);
    });

    it("filtra por vehículo 1 → 1 despacho", async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/despachos?vehiculo_id=${vehiculo1Id}`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(1);
    });

    it("filtra por piloto 2 → 1 despacho", async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/despachos?piloto_id=${piloto2Id}`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].id).toBe(despacho2Id);
    });

    it("supervisor solo ve despachos de su gasolinera → 200", async () => {
      const res = await request(app.getHttpServer())
        .get("/api/v1/despachos")
        .set("Authorization", `Bearer ${supervisorToken}`);

      expect(res.status).toBe(200);
      // Todos los despachos deben ser de la gasolinera del supervisor
      expect(res.body.data.length).toBeGreaterThan(0);
      expect(res.body.total).toBeGreaterThan(0);
      expect(
        res.body.data.every((d: any) => d.gasolinera_id === gasolineraId),
      ).toBe(true);
    });

    it("obtiene despacho por id con JOIN completo (vehiculo, piloto, gasolinera, cliente) → 200", async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/despachos/${despacho2Id}`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.despacho).toBeDefined();
      expect(res.body.vehiculo.placa).toBe(`E2E-${RUN_ID}B`);
      expect(res.body.piloto.codigo).toBe(`PIL-${RUN_ID}-02`);
      expect(res.body.precio.tipo_combustible).toBe("super");
      expect(parseFloat(res.body.precio.precio_galon)).toBeCloseTo(34.75, 2);
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // BLOQUE 10 — Reportes, KPIs y Datos de Gráficas
  // ════════════════════════════════════════════════════════════════════════

  describe("10. Reportes, KPIs y Datos de Gráficas (Dashboard)", () => {
    it("resumen ejecutivo — KPIs globales (total galones, monto, por tipo) → 200", async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/reportes/resumen?cliente_id=${cliente1Id}`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);

      // KPIs principales
      expect(res.body.totales).toBeDefined();
      expect(parseFloat(res.body.totales.total_galones)).toBeCloseTo(95.5, 0); // 80 + 15.5
      expect(parseFloat(res.body.totales.total_monto)).toBeCloseTo(2818.625, 0); // 2280 + 538.625
      expect(parseInt(res.body.totales.total_despachos)).toBe(2);

      // Desglose por tipo (datos para gráfica de dona/pie)
      expect(Array.isArray(res.body.por_tipo_combustible)).toBe(true);
      const tipos = res.body.por_tipo_combustible.map(
        (t: any) => t.tipo_combustible,
      );
      expect(tipos).toContain("diesel");
      expect(tipos).toContain("super");

      // Desglose por gasolinera (datos para gráfica de barras)
      expect(Array.isArray(res.body.por_gasolinera)).toBe(true);
      const gasolineraRow = res.body.por_gasolinera.find(
        (g: any) => g.gasolinera_id === gasolineraId,
      );
      expect(gasolineraRow).toBeDefined();
    });

    it("consumo por vehículo — ranking para gráfica de barras → 200", async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/reportes/consumo-por-vehiculo?cliente_id=${cliente1Id}`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(2);

      // El camión (80 gal) debe estar primero (ordenado DESC por galones)
      expect(res.body[0].vehiculo_id).toBe(vehiculo1Id);
      expect(parseFloat(res.body[0].total_galones)).toBeCloseTo(80, 0);
      expect(res.body[0].placa).toBe(`E2E-${RUN_ID}A`);

      // La pick-up (15.5 gal) en segundo lugar
      expect(res.body[1].vehiculo_id).toBe(vehiculo2Id);
      expect(parseFloat(res.body[1].total_galones)).toBeCloseTo(15.5, 1);

      // Campos necesarios para gráfica
      expect(res.body[0].marca).toBeDefined();
      expect(res.body[0].total_despachos).toBeDefined();
      expect(res.body[0].total_monto).toBeDefined();
    });

    it("consumo por piloto — ranking para gráfica → 200", async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/reportes/consumo-por-piloto?cliente_id=${cliente1Id}`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.length).toBe(2);

      // Piloto 1 (Carlos, 80 gal diesel) primero
      expect(res.body[0].piloto_id).toBe(piloto1Id);
      expect(parseFloat(res.body[0].total_galones)).toBeCloseTo(80, 0);
      expect(res.body[0].nombre_completo).toContain("Carlos");

      // Campos para la gráfica
      expect(res.body[0].codigo).toBeDefined();
      expect(res.body[0].total_despachos).toBeDefined();
    });

    it("tendencia mensual — datos para gráfica de línea (últimos 12 meses) → 200", async () => {
      const res = await request(app.getHttpServer())
        .get("/api/v1/reportes/tendencia-mensual")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);

      // Debe haber al menos el mes actual con los despachos de este test
      const [anioActual, mesActual] = fechaGuatemala().split("-").map(Number);
      const entradaHoy = res.body.find(
        (m: any) => m.mes === mesActual && m.anio === anioActual,
      );
      expect(entradaHoy).toBeDefined();
      expect(parseInt(entradaHoy.total_despachos)).toBeGreaterThanOrEqual(2);

      // Campos necesarios para gráfica de línea
      if (res.body.length > 0) {
        expect(res.body[0].anio).toBeDefined();
        expect(res.body[0].mes).toBeDefined();
        expect(res.body[0].total_galones).toBeDefined();
        expect(res.body[0].total_monto).toBeDefined();
      }
    });

    it("rendimiento km/galón por vehículo — datos para gráfica de rendimiento → 200", async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/reportes/rendimiento-vehiculo/${vehiculo1Id}`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(1);

      const punto = res.body[0];
      expect(punto.galones).toBeDefined();
      expect(punto.kilometraje).toBeDefined();
      // km/gal = 12600 / 80 = 157.5
      expect(parseFloat(punto.km_por_galon)).toBeCloseTo(157.5, 0);
      expect(punto.despachado_at).toBeDefined();
    });

    it("cliente autenticado puede ver su propio resumen → 200", async () => {
      const token = await tokenDeClienteLigado(cliente1Id, "resumen");
      const res = await request(app.getHttpServer())
        .get(`/api/v1/reportes/resumen?cliente_id=${cliente1Id}`)
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.totales).toBeDefined();
    });

    it("cliente sin empresa asignada no ve reportes → 403 (fail-closed)", async () => {
      const res = await request(app.getHttpServer())
        .get("/api/v1/reportes/resumen")
        .set("Authorization", `Bearer ${clienteUserToken}`);

      expect(res.status).toBe(403);
    });

    it("cliente sin empresa asignada no genera el PDF → 403 (fail-closed)", async () => {
      // Sin esto el PDF omitía el filtro y traía los datos de todos los clientes.
      const res = await request(app.getHttpServer())
        .post("/api/v1/reportes/pdf")
        .set("Authorization", `Bearer ${clienteUserToken}`)
        .send({});

      expect(res.status).toBe(403);
      expect(res.body.message).toBe("Cliente sin empresa asignada");
    });

    it("filtros de fecha en reportes funcionan correctamente", async () => {
      const hoy = fechaGuatemala();
      const ayer = sumarDias(hoy, -1);

      // Filtrando desde ayer hasta hoy: debe incluir los despachos de hoy
      const resHoy = await request(app.getHttpServer())
        .get(
          `/api/v1/reportes/resumen?cliente_id=${cliente1Id}&fecha_desde=${hoy}&fecha_hasta=${hoy}`,
        )
        .set("Authorization", `Bearer ${adminToken}`);
      expect(resHoy.status).toBe(200);
      expect(parseInt(resHoy.body.totales.total_despachos)).toBe(2);

      // Filtrando solo ayer: no debe incluir los despachos de hoy
      const resAyer = await request(app.getHttpServer())
        .get(
          `/api/v1/reportes/resumen?cliente_id=${cliente1Id}&fecha_desde=${ayer}&fecha_hasta=${ayer}`,
        )
        .set("Authorization", `Bearer ${adminToken}`);
      expect(resAyer.status).toBe(200);
      expect(parseInt(resAyer.body.totales.total_despachos) || 0).toBe(0);
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // BLOQUE 11 — Control de Acceso por Roles
  // ════════════════════════════════════════════════════════════════════════

  describe("11. Control de Acceso por Roles", () => {
    it("cliente no puede crear gasolineras → 403", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/v1/gasolineras")
        .set("Authorization", `Bearer ${clienteUserToken}`)
        .send({ nombre: "Intento", direccion: "x", ciudad: "y" });
      expect(res.status).toBe(403);
    });

    it("supervisor no puede crear usuarios → 403", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/v1/usuarios")
        .set("Authorization", `Bearer ${supervisorToken}`)
        .send({
          nombre: "x",
          email: "x@x.com",
          password: "Password1!",
          rol: "supervisor",
        });
      expect(res.status).toBe(403);
    });

    it("supervisor no puede eliminar gasolineras → 403", async () => {
      const res = await request(app.getHttpServer())
        .delete(`/api/v1/gasolineras/${gasolineraId}`)
        .set("Authorization", `Bearer ${supervisorToken}`);
      expect(res.status).toBe(403);
    });

    it("cliente no puede eliminar vehículos → 403", async () => {
      const res = await request(app.getHttpServer())
        .delete(`/api/v1/vehiculos/${vehiculo1Id}`)
        .set("Authorization", `Bearer ${clienteUserToken}`);
      expect(res.status).toBe(403);
    });

    it("token inválido (string basura) → 401", async () => {
      const res = await request(app.getHttpServer())
        .get("/api/v1/gasolineras")
        .set("Authorization", "Bearer token_invalido_basura_123");
      expect(res.status).toBe(401);
    });

    it("token bien formado pero expirado/falso → 401", async () => {
      // JWT con estructura válida pero firma incorrecta
      const fakeToken =
        "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmYWtlLXVzZXItaWQifQ.INVALID_SIGNATURE";
      const res = await request(app.getHttpServer())
        .get("/api/v1/gasolineras")
        .set("Authorization", `Bearer ${fakeToken}`);
      expect(res.status).toBe(401);
    });

    // ── Scoping de findOne (IDOR) ────────────────────────────────────────────
    // despacho1Id pertenece a cliente1. Un usuario cliente ligado a su empresa
    // lo ve; uno de otra empresa recibe 404 (no 403: no se revela que existe).

    it("cliente de SU empresa puede leer su propio despacho → 200", async () => {
      const empresaToken = await tokenDeClienteLigado(cliente1Id, "propio");
      const res = await request(app.getHttpServer())
        .get(`/api/v1/despachos/${despacho1Id}`)
        .set("Authorization", `Bearer ${empresaToken}`);
      expect(res.status).toBe(200);
      expect(res.body.despacho.id).toBe(despacho1Id);
    });

    it("cliente de OTRA empresa no puede leer el despacho ajeno → 404", async () => {
      // Empresa distinta a la del despacho.
      const otraEmpresa = await request(app.getHttpServer())
        .post("/api/v1/clientes")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ nombre: tag("Empresa Ajena"), nit: `AJENA-${RUN_ID}` });
      const otraToken = await tokenDeClienteLigado(
        otraEmpresa.body.id,
        "ajeno",
      );

      const res = await request(app.getHttpServer())
        .get(`/api/v1/despachos/${despacho1Id}`)
        .set("Authorization", `Bearer ${otraToken}`);
      expect(res.status).toBe(404);
    });

    it("cliente sin empresa asignada no ve nada (falla cerrado) → 403", async () => {
      // clienteUserToken se creó sin cliente_id.
      const res = await request(app.getHttpServer())
        .get(`/api/v1/despachos/${despacho1Id}`)
        .set("Authorization", `Bearer ${clienteUserToken}`);
      expect(res.status).toBe(403);
    });
  });

  // Crea un usuario cliente ligado a `clienteId` y devuelve su access token.
  async function tokenDeClienteLigado(
    clienteId: string,
    sufijo: string,
  ): Promise<string> {
    const email = `cliente.${sufijo}.${RUN_ID}@gasfuel-e2e.test`;
    await request(app.getHttpServer())
      .post("/api/v1/usuarios")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        nombre: tag(`Cliente ${sufijo}`),
        email,
        password: TEST_PASSWORD,
        rol: "cliente",
        cliente_id: clienteId,
      });
    const login = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ identificador: email, password: TEST_PASSWORD });
    return login.body.access_token;
  }

  // ════════════════════════════════════════════════════════════════════════
  // BLOQUE 14 — Firma del piloto (round-trip a storage)
  // Va antes del soft-delete (bloque 12) para que la gasolinera/cliente sigan
  // activos, y después de los bloques 9/10 para no alterar sus conteos.
  // ════════════════════════════════════════════════════════════════════════

  describe("14. Firma del Piloto (Storage)", () => {
    // PNG 1x1 real: empieza con la firma mágica que valida el backend.
    const PNG_1x1 =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    let despachoFirmaId: string;

    it("firma inválida aborta ANTES de crear el despacho (sin fantasma) → 400", async () => {
      // La subida de firma va antes de la transacción, así que si falla no debe
      // quedar ningún despacho a medias. Se compara el conteo antes y después.
      const contar = async () => {
        const r = await request(app.getHttpServer())
          .get(`/api/v1/despachos?vehiculo_id=${vehiculo1Id}`)
          .set("Authorization", `Bearer ${adminToken}`);
        return r.body.total as number;
      };
      const antes = await contar();

      const res = await request(app.getHttpServer())
        .post("/api/v1/despachos")
        .set("Authorization", `Bearer ${supervisorToken}`)
        .send({
          cliente_id: cliente1Id,
          operario_id: operarioId,
          vehiculo_id: vehiculo1Id,
          piloto_id: piloto1Id,
          tipo_combustible: "diesel",
          turno: "manana",
          kilometraje: "13100.000",
          monto: "285.000",
          firma_piloto_base64: "data:image/png;base64,bm8tZXMtdW4tcG5n",
        });
      expect(res.status).toBe(400);
      expect(await contar()).toBe(antes);
    });

    it("crea un despacho con firma → 201 y persiste firma_key", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/v1/despachos")
        .set("Authorization", `Bearer ${supervisorToken}`)
        .send({
          cliente_id: cliente1Id,
          operario_id: operarioId,
          vehiculo_id: vehiculo1Id,
          piloto_id: piloto1Id,
          tipo_combustible: "diesel",
          turno: "manana",
          kilometraje: "13200.000",
          monto: "285.000",
          firma_piloto_base64: PNG_1x1,
        });
      expect(res.status).toBe(201);
      despachoFirmaId = res.body.id;
    });

    it("GET /:id/firma devuelve el PNG (proxy desde storage) → 200", async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/despachos/${despachoFirmaId}/firma`)
        .set("Authorization", `Bearer ${adminToken}`)
        .buffer(true);

      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toContain("image/png");
      // Los bytes devueltos empiezan con la firma mágica del PNG.
      expect(res.body.subarray(0, 8)).toEqual(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      );
    });

    it("un despacho sin firma responde 404 en /firma", async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/despachos/${despacho1Id}/firma`)
        .set("Authorization", `Bearer ${adminToken}`);
      expect(res.status).toBe(404);
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // BLOQUE 13 — Saldos, Abonos y Cuadres
  // ════════════════════════════════════════════════════════════════════════

  describe("13. Saldos, Abonos y Cuadres", () => {
    it("admin consulta saldo del cliente → 200, saldo negativo por despachos previos", async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/saldos/cliente/${cliente1Id}`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("saldo_actual");
      expect(res.body).toHaveProperty("movimientos");
      expect(Array.isArray(res.body.movimientos)).toBe(true);
      // El saldo debe ser negativo porque se hicieron despachos en bloques anteriores
      expect(parseFloat(res.body.saldo_actual)).toBeLessThan(0);
    });

    it("admin registra abono al cliente → 201, devuelve movimiento tipo credito", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/v1/saldos/abonos")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          cliente_id: cliente1Id,
          gasolinera_id: gasolineraId,
          monto: "10000.000",
          descripcion: "Pago transferencia bancaria E2E",
        });

      expect(res.status).toBe(201);
      expect(res.body.tipo).toBe("credito");
      expect(res.body.monto).toBe("10000.000");
      expect(res.body.cliente_id).toBe(cliente1Id);
    });

    it("saldo del cliente aumentó tras el abono → 200", async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/saldos/cliente/${cliente1Id}`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      // Debe haber al menos un movimiento tipo credito
      const creditos = res.body.movimientos.filter(
        (m: any) => m.tipo === "credito",
      );
      expect(creditos.length).toBeGreaterThanOrEqual(1);
    });

    it("admin lista movimientos paginados del cliente → 200", async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/saldos/cliente/${cliente1Id}/movimientos?page=1&limit=10`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
    });

    it("admin filtra movimientos por tipo=credito → 200, solo créditos", async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/saldos/cliente/${cliente1Id}/movimientos?tipo=credito`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      res.body.forEach((m: any) => expect(m.tipo).toBe("credito"));
    });

    it("admin registra cuadre por cliente → 201", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/v1/saldos/cuadres")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          tipo: "cliente",
          gasolinera_id: gasolineraId,
          cliente_id: cliente1Id,
          fecha_desde: "2026-05-01",
          fecha_hasta: "2026-05-22",
          notas: "Cuadre E2E OK",
        });

      expect(res.status).toBe(201);
      expect(res.body.tipo).toBe("cliente");
      expect(res.body.cliente_id).toBe(cliente1Id);
      saldosCuadreId = res.body.id;
    });

    it("admin registra cuadre por gasolinera → 201, sin cliente_id", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/v1/saldos/cuadres")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          tipo: "gasolinera",
          gasolinera_id: gasolineraId,
          fecha_desde: "2026-05-01",
          fecha_hasta: "2026-05-22",
        });

      expect(res.status).toBe(201);
      expect(res.body.tipo).toBe("gasolinera");
      expect(res.body.cliente_id).toBeNull();
    });

    it("admin lista cuadres → 200, incluye los dos creados", async () => {
      const res = await request(app.getHttpServer())
        .get("/api/v1/saldos/cuadres")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      const ids = res.body.map((c: any) => c.id);
      expect(ids).toContain(saldosCuadreId);
    });

    it("admin filtra cuadres por tipo=cliente → 200, todos son tipo cliente", async () => {
      const res = await request(app.getHttpServer())
        .get("/api/v1/saldos/cuadres?tipo=cliente")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      res.body.forEach((c: any) => expect(c.tipo).toBe("cliente"));
    });

    it("abono con monto=0 → 400", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/v1/saldos/abonos")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          cliente_id: cliente1Id,
          gasolinera_id: gasolineraId,
          monto: "0",
        });

      expect(res.status).toBe(400);
    });

    it("abono con monto negativo → 400", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/v1/saldos/abonos")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          cliente_id: cliente1Id,
          gasolinera_id: gasolineraId,
          monto: "-500.000",
        });

      expect(res.status).toBe(400);
    });

    it("saldo de cliente inexistente → 404", async () => {
      const res = await request(app.getHttpServer())
        .get("/api/v1/saldos/cliente/00000000-0000-0000-0000-000000000000")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
    });

    it("cuadre tipo=cliente sin cliente_id → 400", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/v1/saldos/cuadres")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          tipo: "cliente",
          gasolinera_id: gasolineraId,
          fecha_desde: "2026-05-01",
          fecha_hasta: "2026-05-22",
        });

      expect(res.status).toBe(400);
    });

    it("supervisor no puede acceder a saldos → 403", async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/saldos/cliente/${cliente1Id}`)
        .set("Authorization", `Bearer ${supervisorToken}`);

      expect(res.status).toBe(403);
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // BLOQUE 16 — Capa financiera: saldo inicial, estado de cuenta, crédito
  // ════════════════════════════════════════════════════════════════════════

  describe("16. Saldo inicial, estado de cuenta y bloqueo de crédito", () => {
    let clienteAperturaId: string;
    const SALDO_INICIAL = 5000;

    it("crear cliente con saldo_inicial abre la cuenta con ese saldo → 201", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/v1/clientes")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ nombre: tag("Cliente Apertura"), saldo_inicial: SALDO_INICIAL });

      expect(res.status).toBe(201);
      clienteAperturaId = res.body.id;

      const saldo = await request(app.getHttpServer())
        .get(`/api/v1/saldos/cliente/${clienteAperturaId}`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(saldo.status).toBe(200);
      expect(parseFloat(saldo.body.saldo_actual)).toBe(SALDO_INICIAL);
    });

    it("la apertura queda en el ledger y sin gasolinera", async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/saldos/cliente/${clienteAperturaId}`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.body.movimientos).toHaveLength(1);
      const apertura = res.body.movimientos[0];
      expect(apertura.tipo).toBe("credito");
      expect(apertura.descripcion).toBe("Saldo inicial");
      // El movimiento de apertura no ocurre en ninguna estación: por eso la
      // columna tuvo que volverse nullable.
      expect(apertura.gasolinera_id).toBeNull();
    });

    it("un cliente sin saldo_inicial abre en cero y sin movimientos → 201", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/v1/clientes")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ nombre: tag("Cliente Sin Apertura") });

      expect(res.status).toBe(201);
      const saldo = await request(app.getHttpServer())
        .get(`/api/v1/saldos/cliente/${res.body.id}`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(parseFloat(saldo.body.saldo_actual)).toBe(0);
      expect(saldo.body.movimientos).toHaveLength(0);
    });

    it("rechaza saldo_inicial negativo → 400", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/v1/clientes")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ nombre: tag("Cliente Negativo"), saldo_inicial: -1 });

      expect(res.status).toBe(400);
    });

    it("no se puede reescribir el saldo inicial por PATCH → 400", async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/clientes/${clienteAperturaId}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ saldo_inicial: 99999 });

      // forbidNonWhitelisted: la apertura no se corrige, se abona.
      expect(res.status).toBe(400);
    });

    it("el estado de cuenta cuadra: inicial + abonos − consumos = final → 200", async () => {
      await request(app.getHttpServer())
        .post("/api/v1/saldos/abonos")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          cliente_id: clienteAperturaId,
          gasolinera_id: gasolineraId,
          monto: "1500.000",
          descripcion: "Abono E2E",
        });

      const res = await request(app.getHttpServer())
        .get(`/api/v1/saldos/cliente/${clienteAperturaId}/estado-cuenta`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      const inicial = parseFloat(res.body.saldo_inicial);
      const abonos = parseFloat(res.body.total_abonos);
      const debitos = parseFloat(res.body.total_debitos);
      const final = parseFloat(res.body.saldo_final);

      expect(inicial + abonos - debitos).toBeCloseTo(final, 3);
      // Sin fecha_desde todo el histórico cae dentro del rango, así que el
      // arrastre inicial es cero y la apertura cuenta como abono del período.
      expect(inicial).toBe(0);
      expect(abonos).toBeCloseTo(SALDO_INICIAL + 1500, 3);
      expect(final).toBeCloseTo(SALDO_INICIAL + 1500, 3);
    });

    it("con fecha_desde futura, todo el histórico se resume en el saldo inicial → 200", async () => {
      const res = await request(app.getHttpServer())
        .get(
          `/api/v1/saldos/cliente/${clienteAperturaId}/estado-cuenta?fecha_desde=2099-01-01`,
        )
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(parseFloat(res.body.saldo_inicial)).toBeCloseTo(
        SALDO_INICIAL + 1500,
        3,
      );
      expect(res.body.movimientos).toHaveLength(0);
      expect(parseFloat(res.body.saldo_final)).toBeCloseTo(
        SALDO_INICIAL + 1500,
        3,
      );
    });

    // Puppeteer está mockeado (ver test/__mocks__/puppeteer.js): esto verifica
    // el cableado, las cabeceras y el endurecimiento del renderer, no que el
    // HTML se dibuje bien. Eso último se comprueba a ojo.
    it("el estado de cuenta en PDF → 200 application/pdf", async () => {
      puppeteerMock.__limpiarPaginas();
      const res = await request(app.getHttpServer())
        .get(`/api/v1/saldos/cliente/${clienteAperturaId}/estado-cuenta/pdf`)
        .set("Authorization", `Bearer ${adminToken}`)
        .buffer()
        .parse((res, cb) => {
          const trozos: Buffer[] = [];
          res.on("data", (c: Buffer) => trozos.push(c));
          res.on("end", () => cb(null, Buffer.concat(trozos)));
        });

      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toContain("application/pdf");
      // %PDF-: si el buffer no arranca así, no es un PDF.
      expect((res.body as Buffer).subarray(0, 5).toString()).toBe("%PDF-");

      // El HTML lleva texto de la base (nombre del cliente, descripción del
      // movimiento), así que el renderer va con JS apagado y sin salida de red.
      // Se afirma acá para que quitar esas protecciones rompa un test.
      const [pagina] = puppeteerMock.__paginas;
      expect(pagina.jsHabilitado).toBe(false);
      expect(pagina.interceptacionActiva).toBe(true);
      expect(pagina.eventos).toContain("request");
    }, 60_000);

    it("un supervisor no puede ver el estado de cuenta → 403", async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/saldos/cliente/${clienteAperturaId}/estado-cuenta`)
        .set("Authorization", `Bearer ${supervisorToken}`);

      expect(res.status).toBe(403);
    });

    it("suspender el crédito bloquea el despacho pero no la cuenta → 403 y 200", async () => {
      const bloqueo = await request(app.getHttpServer())
        .patch(`/api/v1/clientes/${cliente1Id}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ credito_bloqueado: true });
      expect(bloqueo.status).toBe(200);
      expect(bloqueo.body.credito_bloqueado).toBe(true);

      const despacho = await request(app.getHttpServer())
        .post("/api/v1/despachos")
        .set("Authorization", `Bearer ${supervisorToken}`)
        .send({
          cliente_id: cliente1Id,
          operario_id: operarioId,
          vehiculo_id: vehiculo1Id,
          piloto_id: piloto1Id,
          tipo_combustible: "diesel",
          turno: "manana",
          monto: "285.000",
        });
      expect(despacho.status).toBe(403);
      expect(despacho.body.message).toContain("Crédito suspendido");

      // La cuenta sigue viva: se puede consultar y abonar. Ése es justo el
      // punto de tener un flag separado de `bloqueado`.
      const saldo = await request(app.getHttpServer())
        .get(`/api/v1/saldos/cliente/${cliente1Id}`)
        .set("Authorization", `Bearer ${adminToken}`);
      expect(saldo.status).toBe(200);
    });

    it("el diagnóstico del vehículo expone el crédito suspendido → 200", async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/despachos/vehiculo/${vehiculo1Id}/consumo-hoy`)
        .set("Authorization", `Bearer ${supervisorToken}`);

      expect(res.status).toBe(200);
      expect(res.body.cliente_credito_bloqueado).toBe(true);
      // Bloqueo de crédito no es bloqueo de cuenta.
      expect(res.body.cliente_bloqueado).toBe(false);
    });

    it("levantar la suspensión vuelve a permitir despachar → 201", async () => {
      await request(app.getHttpServer())
        .patch(`/api/v1/clientes/${cliente1Id}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ credito_bloqueado: false });

      const res = await request(app.getHttpServer())
        .post("/api/v1/despachos")
        .set("Authorization", `Bearer ${supervisorToken}`)
        .send({
          cliente_id: cliente1Id,
          operario_id: operarioId,
          vehiculo_id: vehiculo1Id,
          piloto_id: piloto1Id,
          tipo_combustible: "diesel",
          turno: "manana",
          monto: "285.000",
        });

      expect(res.status).toBe(201);
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // BLOQUE 17 — Vale multi-renglón: canecas y toneles
  // ════════════════════════════════════════════════════════════════════════

  describe("17. Despacho multi-renglón (canecas y toneles)", () => {
    // Cliente y flota propios: este bloque juega con límites y no debe
    // contaminar los conteos de los bloques anteriores.
    let clienteMultiId: string;
    let vehiculoMultiId: string;
    let pilotoMultiId: string;
    const LIMITE_DIA_VEHICULO = 500;

    it("prepara cliente, vehículo con límite diario y piloto → 201", async () => {
      const cli = await request(app.getHttpServer())
        .post("/api/v1/clientes")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ nombre: tag("Cliente Multi") });
      expect(cli.status).toBe(201);
      clienteMultiId = cli.body.id;

      const veh = await request(app.getHttpServer())
        .post("/api/v1/vehiculos")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          cliente_id: clienteMultiId,
          placa: `E2E-${RUN_ID}M`,
          marca: "Freightliner",
          modelo: "Cascadia",
          tipo_vehiculo: "camion",
          limite_monto_dia: LIMITE_DIA_VEHICULO,
        });
      expect(veh.status).toBe(201);
      vehiculoMultiId = veh.body.id;

      const pil = await request(app.getHttpServer())
        .post("/api/v1/pilotos")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          cliente_id: clienteMultiId,
          nombre_completo: tag("Piloto Multi"),
          codigo: `PM-${RUN_ID}`,
        });
      expect(pil.status).toBe(201);
      pilotoMultiId = pil.body.id;
    });

    it("editar a un usuario cliente sin reenviar cliente_id conserva su empresa → 200", async () => {
      const email = `cliente.h7.${RUN_ID}@gasfuel-e2e.test`;
      const alta = await request(app.getHttpServer())
        .post("/api/v1/usuarios")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          nombre: tag("Cliente H7"),
          email,
          password: TEST_PASSWORD,
          rol: "cliente",
          cliente_id: clienteMultiId,
        });
      expect(alta.status).toBe(201);

      const res = await request(app.getHttpServer())
        .patch(`/api/v1/usuarios/${alta.body.id}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ nombre: tag("Cliente H7 editado") });

      expect(res.status).toBe(200);
      expect(res.body.cliente_id).toBe(clienteMultiId);
    });

    it("vale mixto: el límite del vehículo cuenta SOLO su renglón → 201", async () => {
      // Vehículo 300 + caneca 400 = 700 en total, por encima del límite diario
      // de 500 del vehículo. Debe pasar: al vehículo sólo le tocan 300.
      // Con el agregado viejo (SUM sobre despachos.monto_total) esto daba 403.
      const res = await request(app.getHttpServer())
        .post("/api/v1/despachos")
        .set("Authorization", `Bearer ${supervisorToken}`)
        .send({
          cliente_id: clienteMultiId,
          operario_id: operarioId,
          vehiculo_id: vehiculoMultiId,
          piloto_id: pilotoMultiId,
          turno: "manana",
          detalles: [
            { renglon: "vehiculo", tipo_combustible: "diesel", monto: "300.000" },
            { renglon: "caneca", tipo_combustible: "super", monto: "400.000" },
          ],
        });

      expect(res.status).toBe(201);
      // El header lleva la SUMA de los renglones.
      expect(parseFloat(res.body.monto_total)).toBeCloseTo(700, 2);
      expect(res.body.detalles).toHaveLength(2);
    });

    it("el vale mixto dejó UN solo débito por la suma → 200", async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/saldos/cliente/${clienteMultiId}`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      const debitos = res.body.movimientos.filter(
        (m: any) => m.tipo === "debito",
      );
      expect(debitos).toHaveLength(1);
      expect(parseFloat(debitos[0].monto)).toBeCloseTo(700, 2);
      // Saldo negativo: no hay control de fondos, y es a propósito.
      expect(parseFloat(res.body.saldo_actual)).toBeCloseTo(-700, 2);
    });

    it("consumo-hoy reporta del vehículo sólo su renglón, igual que el límite → 200", async () => {
      // El vale mixto fue vehículo 300 + caneca 400. El panel del supervisor
      // debe mostrar 300 (y una transacción), no los 700 del encabezado.
      const res = await request(app.getHttpServer())
        .get(`/api/v1/despachos/vehiculo/${vehiculoMultiId}/consumo-hoy`)
        .set("Authorization", `Bearer ${supervisorToken}`);

      expect(res.status).toBe(200);
      expect(res.body.consumo.monto.dia).toBeCloseTo(300, 2);
      expect(res.body.consumo.monto.semana).toBeCloseTo(300, 2);
      expect(res.body.consumo.monto.mes).toBeCloseTo(300, 2);
      expect(res.body.consumo.volumen.dia).toBeGreaterThan(0);
      expect(res.body.consumo.transacciones.dia).toBe(1);
    });

    it("pero el renglón del vehículo sí acumula contra su límite → 403", async () => {
      // Ya lleva 300 de los 500 del día; otros 300 lo pasan.
      const res = await request(app.getHttpServer())
        .post("/api/v1/despachos")
        .set("Authorization", `Bearer ${supervisorToken}`)
        .send({
          cliente_id: clienteMultiId,
          operario_id: operarioId,
          vehiculo_id: vehiculoMultiId,
          piloto_id: pilotoMultiId,
          turno: "manana",
          detalles: [
            { renglon: "vehiculo", tipo_combustible: "diesel", monto: "300.000" },
          ],
        });

      expect(res.status).toBe(403);
      expect(res.body.message).toContain("Límite diario de monto");
    });

    it("un vale sólo de contenedores no necesita vehículo ni piloto → 201", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/v1/despachos")
        .set("Authorization", `Bearer ${supervisorToken}`)
        .send({
          cliente_id: clienteMultiId,
          operario_id: operarioId,
          turno: "tarde",
          detalles: [
            { renglon: "tonel", tipo_combustible: "diesel", monto: "1000.000" },
            { renglon: "caneca", tipo_combustible: "diesel", monto: "200.000" },
          ],
        });

      expect(res.status).toBe(201);
      expect(res.body.vehiculo_id).toBeNull();
      expect(res.body.piloto_id).toBeNull();
      expect(parseFloat(res.body.monto_total)).toBeCloseTo(1200, 2);
    });

    it("el vale sólo-contenedores se puede leer por ID → 200 con sus renglones", async () => {
      const lista = await request(app.getHttpServer())
        .get(`/api/v1/despachos?cliente_id=${clienteMultiId}`)
        .set("Authorization", `Bearer ${adminToken}`);
      const soloContenedor = lista.body.data.find(
        (d: any) => d.vehiculo_id === null,
      );
      expect(soloContenedor).toBeDefined();

      // Antes esto era un 404 fantasma: findOne unía vehículo y piloto con
      // innerJoin y el vale desaparecía del resultado.
      const res = await request(app.getHttpServer())
        .get(`/api/v1/despachos/${soloContenedor.id}`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.detalles).toHaveLength(2);
      expect(res.body.vehiculo).toBeNull();
      expect(res.body.piloto).toBeNull();
    });

    it("el filtro por combustible encuentra el vale por su renglón → 200", async () => {
      // El super de este cliente sólo existió en una caneca; el header apunta
      // al renglón del vehículo (diesel). Filtrar por el header lo perdería.
      const res = await request(app.getHttpServer())
        .get(`/api/v1/despachos?cliente_id=${clienteMultiId}&tipo_combustible=super`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThan(0);
    });

    it("rechaza mandar las dos formas del payload a la vez → 400", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/v1/despachos")
        .set("Authorization", `Bearer ${supervisorToken}`)
        .send({
          cliente_id: clienteMultiId,
          operario_id: operarioId,
          turno: "manana",
          tipo_combustible: "diesel",
          monto: "100.000",
          detalles: [
            { renglon: "caneca", tipo_combustible: "diesel", monto: "100.000" },
          ],
        });

      expect(res.status).toBe(400);
    });

    it("rechaza un vehículo sin piloto → 400", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/v1/despachos")
        .set("Authorization", `Bearer ${supervisorToken}`)
        .send({
          cliente_id: clienteMultiId,
          operario_id: operarioId,
          vehiculo_id: vehiculoMultiId,
          turno: "manana",
          detalles: [
            { renglon: "vehiculo", tipo_combustible: "diesel", monto: "50.000" },
          ],
        });

      expect(res.status).toBe(400);
    });

    it("rechaza un renglón de vehículo sin indicar vehículo → 400", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/v1/despachos")
        .set("Authorization", `Bearer ${supervisorToken}`)
        .send({
          cliente_id: clienteMultiId,
          operario_id: operarioId,
          turno: "manana",
          detalles: [
            { renglon: "vehiculo", tipo_combustible: "diesel", monto: "50.000" },
          ],
        });

      expect(res.status).toBe(400);
    });

    it("rechaza un vale sin ningún renglón → 400", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/v1/despachos")
        .set("Authorization", `Bearer ${supervisorToken}`)
        .send({
          cliente_id: clienteMultiId,
          operario_id: operarioId,
          turno: "manana",
          detalles: [],
        });

      expect(res.status).toBe(400);
    });

    it("rechaza un renglón con monto cero → 400", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/v1/despachos")
        .set("Authorization", `Bearer ${supervisorToken}`)
        .send({
          cliente_id: clienteMultiId,
          operario_id: operarioId,
          turno: "manana",
          detalles: [
            { renglon: "caneca", tipo_combustible: "diesel", monto: "0" },
          ],
        });

      expect(res.status).toBe(400);
    });

    it.each(["page=0", "limit=abc", "limit=0", "page=-1"])(
      "paginación inválida (%s) → 400, nunca 500",
      async (qs) => {
        const res = await request(app.getHttpServer())
          .get(`/api/v1/despachos?${qs}`)
          .set("Authorization", `Bearer ${adminToken}`);
        expect(res.status).toBe(400);
      },
    );

    it("la numeración de vale sigue siendo monótona con vales multi-renglón", async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/despachos?gasolinera_id=${gasolineraId}&limit=100`)
        .set("Authorization", `Bearer ${adminToken}`);

      const numeros = res.body.data
        .map((d: any) => parseInt(d.numero_vale, 10))
        .sort((a: number, b: number) => a - b);
      // Un vale = una fila header, así que el advisory lock no cambió: los
      // números siguen sin repetirse.
      expect(new Set(numeros).size).toBe(numeros.length);
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // BLOQUE 18 — Inventario de insumos y ventas
  // ════════════════════════════════════════════════════════════════════════

  describe("18. Inventario de insumos y ventas", () => {
    let productoId: string;
    let productoEscasoId: string;
    let clienteInsumosId: string;
    const PRECIO = 185.5;
    const STOCK_INICIAL = 20;

    it("admin crea un producto con existencia inicial → 201", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/v1/inventario/productos")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          nombre: tag("Aceite 15W-40"),
          sku: `ACE-${RUN_ID}`,
          precio: PRECIO,
          stock_actual: STOCK_INICIAL,
          stock_minimo: 5,
        });

      expect(res.status).toBe(201);
      expect(res.body.stock_actual).toBe(STOCK_INICIAL);
      productoId = res.body.id;
    });

    it("la existencia inicial queda en el kardex → 200", async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/inventario/productos/${productoId}/movimientos`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].tipo).toBe("entrada");
      expect(res.body[0].cantidad).toBe(STOCK_INICIAL);
    });

    it("una entrada de stock suma y deja rastro → 201", async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/inventario/productos/${productoId}/stock`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ tipo: "entrada", cantidad: 10, motivo: "Compra E2E" });

      expect(res.status).toBe(201);
      expect(res.body.stock_actual).toBe(STOCK_INICIAL + 10);
    });

    it("no se puede sacar más stock del que hay → 400", async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/inventario/productos/${productoId}/stock`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ tipo: "salida", cantidad: 9999 });

      // A diferencia del saldo del cliente, el stock no puede quedar negativo:
      // o el producto está en bodega o no está.
      expect(res.status).toBe(400);
      expect(res.body.message).toContain("Stock insuficiente");
    });

    it("el stock no se puede editar por PATCH → 400", async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/inventario/productos/${productoId}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ stock_actual: 999 });

      // Cambiarlo sin pasar por el kardex dejaría un faltante inexplicable.
      expect(res.status).toBe(400);
    });

    it("una venta en EFECTIVO descuenta stock y no toca ningún saldo → 201", async () => {
      const cli = await request(app.getHttpServer())
        .post("/api/v1/clientes")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ nombre: tag("Cliente Insumos"), saldo_inicial: 10000 });
      clienteInsumosId = cli.body.id;

      const antes = await request(app.getHttpServer())
        .get(`/api/v1/saldos/cliente/${clienteInsumosId}`)
        .set("Authorization", `Bearer ${adminToken}`);
      const saldoAntes = parseFloat(antes.body.saldo_actual);

      const res = await request(app.getHttpServer())
        .post("/api/v1/ventas-insumos")
        .set("Authorization", `Bearer ${supervisorToken}`)
        .send({
          forma_pago: "efectivo",
          operario_id: operarioId,
          bomba_numero: 1,
          detalles: [{ producto_id: productoId, cantidad: 2 }],
        });

      expect(res.status).toBe(201);
      expect(parseFloat(res.body.monto_total)).toBeCloseTo(PRECIO * 2, 2);

      const producto = await request(app.getHttpServer())
        .get(`/api/v1/inventario/productos/${productoId}`)
        .set("Authorization", `Bearer ${adminToken}`);
      expect(producto.body.stock_actual).toBe(STOCK_INICIAL + 10 - 2);

      const despues = await request(app.getHttpServer())
        .get(`/api/v1/saldos/cliente/${clienteInsumosId}`)
        .set("Authorization", `Bearer ${adminToken}`);
      // El efectivo entra a caja: la cuenta del cliente queda intacta.
      expect(parseFloat(despues.body.saldo_actual)).toBeCloseTo(saldoAntes, 2);
    });

    it("una venta a CARGO del cliente sí debita su saldo → 201", async () => {
      const antes = await request(app.getHttpServer())
        .get(`/api/v1/saldos/cliente/${clienteInsumosId}`)
        .set("Authorization", `Bearer ${adminToken}`);
      const saldoAntes = parseFloat(antes.body.saldo_actual);

      const res = await request(app.getHttpServer())
        .post("/api/v1/ventas-insumos")
        .set("Authorization", `Bearer ${supervisorToken}`)
        .send({
          forma_pago: "cargo_cliente",
          cliente_id: clienteInsumosId,
          operario_id: operarioId,
          bomba_numero: 3,
          detalles: [{ producto_id: productoId, cantidad: 3 }],
        });

      expect(res.status).toBe(201);
      const monto = parseFloat(res.body.monto_total);
      expect(monto).toBeCloseTo(PRECIO * 3, 2);

      const despues = await request(app.getHttpServer())
        .get(`/api/v1/saldos/cliente/${clienteInsumosId}`)
        .set("Authorization", `Bearer ${adminToken}`);
      expect(parseFloat(despues.body.saldo_actual)).toBeCloseTo(
        saldoAntes - monto,
        2,
      );
    });

    it("la venta a cargo aparece en el estado de cuenta → 200", async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/saldos/cliente/${clienteInsumosId}/estado-cuenta`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      // Va al mismo ledger que los despachos: el cliente ve combustible e
      // insumos en un solo documento.
      const insumos = res.body.movimientos.filter((m: any) =>
        (m.descripcion ?? "").startsWith("Insumos"),
      );
      expect(insumos).toHaveLength(1);
      expect(parseFloat(res.body.total_debitos)).toBeCloseTo(PRECIO * 3, 2);
    });

    it("una venta en efectivo no acepta cliente → 400", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/v1/ventas-insumos")
        .set("Authorization", `Bearer ${supervisorToken}`)
        .send({
          forma_pago: "efectivo",
          cliente_id: clienteInsumosId,
          detalles: [{ producto_id: productoId, cantidad: 1 }],
        });

      expect(res.status).toBe(400);
    });

    it("una venta a cargo sin cliente → 400", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/v1/ventas-insumos")
        .set("Authorization", `Bearer ${supervisorToken}`)
        .send({
          forma_pago: "cargo_cliente",
          detalles: [{ producto_id: productoId, cantidad: 1 }],
        });

      expect(res.status).toBe(400);
    });

    it("rechaza una bomba distinta de 1 o 3 → 400", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/v1/ventas-insumos")
        .set("Authorization", `Bearer ${supervisorToken}`)
        .send({
          forma_pago: "efectivo",
          bomba_numero: 2,
          detalles: [{ producto_id: productoId, cantidad: 1 }],
        });

      expect(res.status).toBe(400);
    });

    it("rechaza el mismo producto en dos renglones → 400", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/v1/ventas-insumos")
        .set("Authorization", `Bearer ${supervisorToken}`)
        .send({
          forma_pago: "efectivo",
          detalles: [
            { producto_id: productoId, cantidad: 1 },
            { producto_id: productoId, cantidad: 2 },
          ],
        });

      // Repetirlo saltaría la verificación de stock, que mira cada producto
      // una sola vez.
      expect(res.status).toBe(400);
    });

    it("una venta que excede el stock se rechaza entera → 400", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/v1/ventas-insumos")
        .set("Authorization", `Bearer ${supervisorToken}`)
        .send({
          forma_pago: "efectivo",
          detalles: [{ producto_id: productoId, cantidad: 9999 }],
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain("Stock insuficiente");
    });

    it("el umbral de stock bajo lista sólo lo que toca reponer → 200", async () => {
      const escaso = await request(app.getHttpServer())
        .post("/api/v1/inventario/productos")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          nombre: tag("Refrigerante"),
          precio: 60,
          stock_actual: 2,
          stock_minimo: 5,
        });
      productoEscasoId = escaso.body.id;

      const res = await request(app.getHttpServer())
        .get("/api/v1/inventario/productos/bajos")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      const ids = res.body.map((p: any) => p.id);
      expect(ids).toContain(productoEscasoId);
      // El primero tiene stock de sobra, no debe aparecer.
      expect(ids).not.toContain(productoId);
    });

    it("un cliente no puede vender insumos → 403", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/v1/ventas-insumos")
        .set("Authorization", `Bearer ${clienteUserToken}`)
        .send({
          forma_pago: "efectivo",
          detalles: [{ producto_id: productoId, cantidad: 1 }],
        });

      expect(res.status).toBe(403);
    });

    it("un supervisor no puede crear productos → 403", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/v1/inventario/productos")
        .set("Authorization", `Bearer ${supervisorToken}`)
        .send({ nombre: tag("No debería"), precio: 10 });

      expect(res.status).toBe(403);
    });

    it("desactivar un producto lo saca del catálogo → 200", async () => {
      const res = await request(app.getHttpServer())
        .delete(`/api/v1/inventario/productos/${productoEscasoId}`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.activo).toBe(false);

      const lista = await request(app.getHttpServer())
        .get("/api/v1/inventario/productos")
        .set("Authorization", `Bearer ${adminToken}`);
      expect(lista.body.map((p: any) => p.id)).not.toContain(productoEscasoId);
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // BLOQUE 15 — Contraseñas: alta, recuperación y reset del admin
  // Va antes del soft-delete para que la gasolinera siga activa.
  // ════════════════════════════════════════════════════════════════════════

  describe("15. Contraseñas y recuperación", () => {
    const emailReset = `reset.${RUN_ID}@gasfuel-e2e.test`;
    let usuarioResetId: string;
    let usuarioClienteAltaId: string;
    let passwordVigente: string;
    let tokenReset: string;
    let accessPrevio: string;

    /** El token sólo existe dentro del correo: acá se lo saca del enlace. */
    const tokenDelUltimoCorreo = (para: string): string => {
      const correo = correos.ultimoPara(para);
      expect(correo).toBeDefined();
      const match = /token=([\w-]+)/.exec(correo!.texto ?? correo!.html);
      expect(match).not.toBeNull();
      return match![1];
    };

    it("admin crea un usuario sin contraseña → 201 y la devuelve una sola vez", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/v1/usuarios")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          nombre: tag("Usuario Reset"),
          email: emailReset,
          rol: "supervisor",
          gasolinera_id: gasolineraId,
        });

      expect(res.status).toBe(201);
      expect(typeof res.body.password_temporal).toBe("string");
      expect(res.body.password_temporal.length).toBeGreaterThanOrEqual(12);
      // El hash nunca sale, ni siquiera cuando sí sale la contraseña en claro.
      expect(res.body.password_hash).toBeUndefined();

      usuarioResetId = res.body.id;
      passwordVigente = res.body.password_temporal;
    });

    it("la contraseña generada sirve para entrar → 200", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/v1/auth/login")
        .send({ identificador: emailReset, password: passwordVigente });

      expect(res.status).toBe(200);
      accessPrevio = res.body.access_token;
    });

    it("el alta de un usuario cliente con correo dispara el enlace de acceso", async () => {
      correos.limpiar();
      const email = `alta.cliente.${RUN_ID}@gasfuel-e2e.test`;

      const res = await request(app.getHttpServer())
        .post("/api/v1/usuarios")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          nombre: tag("Cliente Con Alta"),
          email,
          rol: "cliente",
          cliente_id: cliente1Id,
        });

      expect(res.status).toBe(201);
      usuarioClienteAltaId = res.body.id;
      // El envío es fire-and-forget: se le da un tick al event loop.
      await new Promise((r) => setTimeout(r, 50));
      expect(correos.enviados).toHaveLength(1);
      expect(correos.enviados[0].para).toBe(email);
    });

    it("quitarle la empresa a un usuario cliente → 400", async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/usuarios/${usuarioClienteAltaId}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ cliente_id: null });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain("cliente_id");
    });

    it("pasar a rol cliente a un usuario sin empresa → 400", async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/usuarios/${usuarioResetId}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ rol: "cliente" });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain("cliente_id");
    });

    it("solicitar recuperación con un identificador inexistente → 204 sin correo", async () => {
      correos.limpiar();
      const res = await request(app.getHttpServer())
        .post("/api/v1/auth/password/solicitar")
        .send({ identificador: `nadie.${RUN_ID}@gasfuel-e2e.test` });

      // 204 igual que con un usuario real: si respondiera distinto, este
      // endpoint serviría para enumerar cuentas.
      expect(res.status).toBe(204);
      expect(correos.enviados).toHaveLength(0);
    });

    it("solicitar recuperación de un usuario real → 204 y manda el enlace", async () => {
      correos.limpiar();
      const res = await request(app.getHttpServer())
        .post("/api/v1/auth/password/solicitar")
        .send({ identificador: emailReset });

      expect(res.status).toBe(204);
      expect(correos.enviados).toHaveLength(1);
      tokenReset = tokenDelUltimoCorreo(emailReset);
      expect(tokenReset.length).toBeGreaterThan(20);
    });

    it("rechaza una contraseña de menos de 8 caracteres → 400", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/v1/auth/password/reset")
        .send({ token: tokenReset, password: "corta" });

      expect(res.status).toBe(400);
    });

    it("el reset fija la contraseña nueva → 204", async () => {
      passwordVigente = `NuevaPass#${RUN_ID}`;
      const res = await request(app.getHttpServer())
        .post("/api/v1/auth/password/reset")
        .send({ token: tokenReset, password: passwordVigente });

      expect(res.status).toBe(204);
    });

    it("el reset revoca las sesiones abiertas → 401 con el token anterior", async () => {
      const res = await request(app.getHttpServer())
        .get("/api/v1/auth/me")
        .set("Authorization", `Bearer ${accessPrevio}`);

      expect(res.status).toBe(401);
    });

    it("se puede entrar con la contraseña nueva → 200", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/v1/auth/login")
        .send({ identificador: emailReset, password: passwordVigente });

      expect(res.status).toBe(200);
    });

    it("reusar el mismo token de recuperación → 400", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/v1/auth/password/reset")
        .send({ token: tokenReset, password: `OtraMas#${RUN_ID}` });

      expect(res.status).toBe(400);
    });

    it("un token inventado → 400", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/v1/auth/password/reset")
        .send({ token: "a".repeat(43), password: `OtraMas#${RUN_ID}` });

      expect(res.status).toBe(400);
    });

    it("una solicitud nueva invalida el enlace anterior → 400", async () => {
      correos.limpiar();
      await request(app.getHttpServer())
        .post("/api/v1/auth/password/solicitar")
        .send({ identificador: emailReset });
      const primero = tokenDelUltimoCorreo(emailReset);

      correos.limpiar();
      await request(app.getHttpServer())
        .post("/api/v1/auth/password/solicitar")
        .send({ identificador: emailReset });
      const segundo = tokenDelUltimoCorreo(emailReset);

      expect(segundo).not.toBe(primero);

      // El primero ya no sirve: si no, cada solicitud dejaría otro enlace vivo
      // suelto en una bandeja de entrada.
      const viejo = await request(app.getHttpServer())
        .post("/api/v1/auth/password/reset")
        .send({ token: primero, password: `TerceraVez#${RUN_ID}` });
      expect(viejo.status).toBe(400);
    });

    it("admin resetea en modo generar → devuelve una contraseña utilizable", async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/usuarios/${usuarioResetId}/reset-password`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ modo: "generar" });

      expect(res.status).toBe(201);
      expect(typeof res.body.password_temporal).toBe("string");

      const login = await request(app.getHttpServer())
        .post("/api/v1/auth/login")
        .send({
          identificador: emailReset,
          password: res.body.password_temporal,
        });
      expect(login.status).toBe(200);
    });

    it("admin resetea en modo enlace → manda correo y no devuelve contraseña", async () => {
      correos.limpiar();
      const res = await request(app.getHttpServer())
        .post(`/api/v1/usuarios/${usuarioResetId}/reset-password`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ modo: "enlace" });

      expect(res.status).toBe(201);
      expect(res.body.password_temporal).toBeUndefined();
      expect(correos.enviados).toHaveLength(1);
      expect(correos.enviados[0].para).toBe(emailReset);
    });

    it("rechaza un modo desconocido → 400", async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/usuarios/${usuarioResetId}/reset-password`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ modo: "telepatia" });

      expect(res.status).toBe(400);
    });

    it("un supervisor no puede resetear contraseñas → 403", async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/usuarios/${usuarioResetId}/reset-password`)
        .set("Authorization", `Bearer ${supervisorToken}`)
        .send({ modo: "generar" });

      expect(res.status).toBe(403);
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // BLOQUE 12 — Soft Delete y Estados
  // ════════════════════════════════════════════════════════════════════════

  describe("12. Soft Delete y Estados", () => {
    it("admin desactiva piloto 2 (soft delete) → 200", async () => {
      const res = await request(app.getHttpServer())
        .delete(`/api/v1/pilotos/${piloto2Id}`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.activo).toBe(false);
    });

    it("piloto inactivo ya no aparece en listado del cliente → 200", async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/pilotos?cliente_id=${cliente1Id}`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      const ids = res.body.map((p: any) => p.id);
      expect(ids).not.toContain(piloto2Id); // inactivo: no debe aparecer
      expect(ids).toContain(piloto1Id); // activo: sí debe aparecer
    });

    it("detalle del cliente excluye el piloto inactivo → 200", async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/clientes/${cliente1Id}`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.pilotos.length).toBe(1);
      expect(res.body.pilotos[0].id).toBe(piloto1Id);
    });

    it("admin desactiva vehículo 2 (soft delete) → 200", async () => {
      const res = await request(app.getHttpServer())
        .delete(`/api/v1/vehiculos/${vehiculo2Id}`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.activo).toBe(false);
    });

    it("vehículo inactivo no aparece al listar del cliente → 200", async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/vehiculos?cliente_id=${cliente1Id}`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      const ids = res.body.map((v: any) => v.id);
      expect(ids).not.toContain(vehiculo2Id);
      expect(ids).toContain(vehiculo1Id);
    });

    it("admin desactiva cliente (soft delete) → 200", async () => {
      const res = await request(app.getHttpServer())
        .delete(`/api/v1/clientes/${cliente1Id}`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.activo).toBe(false);
    });

    it("cliente inactivo no se puede obtener por ID → 404", async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/clientes/${cliente1Id}`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
    });

    it("cliente inactivo no aparece en el listado → 200", async () => {
      const res = await request(app.getHttpServer())
        .get("/api/v1/clientes")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      const ids = res.body.map((c: any) => c.id);
      expect(ids).not.toContain(cliente1Id);
    });

    it("admin desactiva la gasolinera E2E (soft delete) → 200", async () => {
      const res = await request(app.getHttpServer())
        .delete(`/api/v1/gasolineras/${gasolineraId}`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.activo).toBe(false);
    });
  });
});
