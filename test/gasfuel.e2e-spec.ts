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
import { eq } from "drizzle-orm";
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
import { usuarios } from "../src/db/schema";

dotenv.config();

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

    it("admin crea usuario CLIENTE → 201", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/v1/usuarios")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          nombre: tag("Usuario Cliente SA"),
          email: `cliente.${RUN_ID}@gasfuel-e2e.test`,
          password: TEST_PASSWORD,
          rol: "cliente",
        });

      expect(res.status).toBe(201);
      expect(res.body.rol).toBe("cliente");
      expect(res.body.password_hash).toBeUndefined();
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
    const today = new Date().toISOString().split("T")[0];

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
    const today = new Date().toISOString().split("T")[0];

    it("admin lista despachos con paginación → 200", async () => {
      const res = await request(app.getHttpServer())
        .get("/api/v1/despachos?page=1&limit=10")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      // Deben aparecer los 2 despachos de este run
      const ids = res.body.map((d: any) => d.id);
      expect(ids).toContain(despacho1Id);
      expect(ids).toContain(despacho2Id);
    });

    it("filtra despachos por cliente → solo aparecen los del cliente E2E", async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/despachos?cliente_id=${cliente1Id}`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.length).toBe(2);
      expect(res.body.every((d: any) => d.cliente_id === cliente1Id)).toBe(
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
      expect(res.body.length).toBe(1);
      expect(res.body[0].id).toBe(despacho1Id);
    });

    it("filtra despachos por fecha_desde y fecha_hasta (hoy) → 2 resultados", async () => {
      const res = await request(app.getHttpServer())
        .get(
          `/api/v1/despachos?cliente_id=${cliente1Id}&fecha_desde=${today}&fecha_hasta=${today}`,
        )
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.length).toBe(2);
    });

    it("filtra por vehículo 1 → 1 despacho", async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/despachos?vehiculo_id=${vehiculo1Id}`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.length).toBe(1);
    });

    it("filtra por piloto 2 → 1 despacho", async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/despachos?piloto_id=${piloto2Id}`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.length).toBe(1);
      expect(res.body[0].id).toBe(despacho2Id);
    });

    it("supervisor solo ve despachos de su gasolinera → 200", async () => {
      const res = await request(app.getHttpServer())
        .get("/api/v1/despachos")
        .set("Authorization", `Bearer ${supervisorToken}`);

      expect(res.status).toBe(200);
      // Todos los despachos deben ser de la gasolinera del supervisor
      expect(res.body.every((d: any) => d.gasolinera_id === gasolineraId)).toBe(
        true,
      );
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
      const mesActual = new Date().getMonth() + 1;
      const anioActual = new Date().getFullYear();
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
      const res = await request(app.getHttpServer())
        .get(`/api/v1/reportes/resumen?cliente_id=${cliente1Id}`)
        .set("Authorization", `Bearer ${clienteUserToken}`);

      expect(res.status).toBe(200);
      expect(res.body.totales).toBeDefined();
    });

    it("filtros de fecha en reportes funcionan correctamente", async () => {
      const hoy = new Date().toISOString().split("T")[0];
      const ayer = new Date(Date.now() - 86400000).toISOString().split("T")[0];

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
        return r.body.length as number;
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
  // BLOQUE 15 — Contraseñas: alta, recuperación y reset del admin
  // Va antes del soft-delete para que la gasolinera siga activa.
  // ════════════════════════════════════════════════════════════════════════

  describe("15. Contraseñas y recuperación", () => {
    const emailReset = `reset.${RUN_ID}@gasfuel-e2e.test`;
    let usuarioResetId: string;
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
      // El envío es fire-and-forget: se le da un tick al event loop.
      await new Promise((r) => setTimeout(r, 50));
      expect(correos.enviados).toHaveLength(1);
      expect(correos.enviados[0].para).toBe(email);
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
