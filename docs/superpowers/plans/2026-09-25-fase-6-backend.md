# Fase 6 (backend): turnos configurables, recordatorio de precios y cierre de huecos — Plan de implementación

**Goal:** Turnos `manana`/`tarde` con horario configurable por gasolinera. 30 minutos antes de cada turno, un aviso por correo y push a admin y jefe de pista para revisar los precios. Además se cierran los huecos del backend (H1, H2, H6, H7, H9) que bloquearían las pruebas en la estación.

**Architecture:** Un módulo `turnos` con funciones puras (ventana de disparo, solapamiento, turno vigente) que se prueban sin BD, más un servicio con `@Cron` que sólo "despierta" y delega en `ejecutar(ahoraUtc)`. La idempotencia la garantiza un índice único en `recordatorios_turno` con `INSERT … ON CONFLICT DO NOTHING`. El push sigue el patrón de `MailService`/`StorageService`: clase abstracta como token de inyección, implementación real (`web-push`) y fake en memoria para los e2e.

**Tech Stack:** NestJS 11, Drizzle ORM 0.45 sobre node-postgres, Jest 30 + ts-jest, supertest, `@nestjs/schedule` 12.0.2, `web-push` 3.6.7.

**Spec:** `docs/superpowers/specs/2026-09-25-fase-6-turnos-recordatorios-design.md`

**Plan hermano:** `../gasolineras-os-frontend/docs/superpowers/plans/2026-09-25-fase-6-frontend.md`. Consume los contratos que este plan produce; conviene ejecutar este primero.

## Global Constraints

- Lenguaje de dominio en español: tablas, columnas, DTOs, rutas y mensajes de error.
- Hora de Guatemala = UTC−6 fijo, sin DST y sin `AT TIME ZONE`. Todo cálculo de fecha u hora local pasa por `src/common/hora-guatemala.ts` (Tarea 1).
- `ValidationPipe` con `whitelist` + `forbidNonWhitelisted`: todo campo de DTO lleva decorador de `class-validator`.
- Guards opt-in por ruta con `@Auth(...roles)`. `DbModule` es global y no se importa.
- Excepciones built-in de Nest con mensajes en español. No se crean filtros nuevos.
- Dependencias nuevas con versión exacta: `@nestjs/schedule@12.0.2`, `web-push@3.6.7`, `@types/web-push@3.6.4`.
- `VAPID_*` y `RECORDATORIOS_ACTIVOS` son **opcionales**: el backend arranca sin ellas.
- Commits: prefijo Conventional Commits, asunto y cuerpo en español, **sin trailers de coautoría ni menciones a herramientas**.
- Filtro de Jest 30: `pnpm test -- --testPathPatterns=<patrón>`.
- Los e2e necesitan Postgres migrado y `.env` con `E2E_ADMIN_EMAIL`/`E2E_ADMIN_PASSWORD`, y corren con `--runInBand` (ya lo hace el script). Si el puerto 5432 está ocupado por otro proyecto, levantar Postgres en otro puerto y pasar `DATABASE_URL` en la línea de comando.

## Review Focus

1. **Tick entre las 18:00 y las 23:59 de Guatemala:** la fecha UTC ya es "mañana". El aviso de un turno que empieza a las 00:15 debe llevar la fecha GT del día siguiente, y los precios del mensaje deben ser los de la fecha GT, no los UTC. Se cubre en la Tarea 2 (`debeRecordar` a las 23:50 GT = 05:50 UTC) y en la Tarea 8 (`ejecutar` a las 23:50 GT = 05:50 UTC, con precios buscados por la fecha GT del inicio del turno).
2. **Admin sin email (sólo teléfono) o jefe de pista inactivo:** el primero no debe romper el envío a los demás; el segundo no debe recibir nada. Tarea 8, e2e.
3. **Suscripción push reasignada:** el mismo navegador se suscribe con otro usuario. El upsert por `endpoint` debe mover la fila al usuario nuevo y no duplicarla. Tarea 6, e2e.
4. **PATCH que sólo cambia `recordatorio_activo`:** no debe disparar la validación de horas contra valores nulos. PATCH con body vacío → 400. Tarea 4, e2e.
5. **Gasolinera bloqueada o inactiva:** no debe recibir recordatorios aunque su turno tenga `recordatorio_activo = true`. Tarea 8, e2e.

## Discrepancias encontradas contra la spec (ya reflejadas en la spec)

- **H9, nuevo:** `despachos.service.ts:369` y `precios-combustible.service.ts:30` calculan "hoy" con `new Date().toISOString()`, es decir en **UTC**. De 18:00 a 23:59 GT buscan el precio de mañana y **todo despacho falla** con "No hay precio registrado…". Los filtros `fecha_desde`/`fecha_hasta` de despachos, Excel, reportes y saldos comparan `timestamp::date` en UTC: un despacho de las 19:00 GT aparece en el día siguiente. Los e2e no lo detectan porque también usan la fecha UTC. Se corrige en la Tarea 1 y se agrega a la spec.
- **Reloj inyectable:** la spec propone un proveedor `RELOJ`. Es más simple que los métodos reciban `ahoraUtc: Date` como parámetro, y el cron y los controllers pasan `new Date()`. Mismo efecto para los tests, sin DI extra.
- **Borrado de suscripciones muertas:** la spec lo pone en `WebPushService`. Aquí `WebPushService.enviar` devuelve `'ok' | 'expirada' | 'error'` y el borrado lo hace `SuscripcionesPushService`. Así `WebPushService` no toca la BD y su unit test no necesita Postgres.
- **`GET /precios-combustible/hoy`** hoy usa `req.user.gasolinera_id`, que el jefe de pista no tiene. Se agrega `?gasolinera_id=` para admin y jefe; el supervisor sigue forzado a la suya.

## Mapa de archivos

| Archivo | Responsabilidad |
|---|---|
| `src/common/hora-guatemala.ts` (nuevo) | `ahoraGuatemala`, `fechaGuatemala`, `sumarDias`, `aMinutos`, fragmento SQL `fechaGtSql` |
| `src/modules/turnos/turnos.util.ts` (nuevo) | Funciones puras: `segmentos`, `seSolapan`, `turnoEnMinuto`, `debeRecordar` |
| `src/modules/turnos/turnos.constants.ts` (nuevo) | `TURNOS`, `TURNOS_POR_DEFECTO` |
| `src/modules/turnos/recordatorio.mensaje.ts` (nuevo) | `armarRecordatorio` (puro) |
| `src/modules/turnos/turnos.service.ts` / `.controller.ts` / `dto/update-turno.dto.ts` (nuevos) | CRUD de turnos y turno vigente |
| `src/modules/turnos/recordatorios.service.ts` (nuevo) | Cron y `ejecutar(ahoraUtc)` |
| `src/modules/turnos/turnos.module.ts` (nuevo) | |
| `src/push/push.service.ts`, `web-push.service.ts`, `in-memory-push.service.ts`, `push.module.ts` (nuevos) | Infraestructura de push (global) |
| `src/modules/push/*` (nuevo) | Endpoints y persistencia de suscripciones |
| `src/db/schema/turnos-gasolinera.schema.ts`, `recordatorios-turno.schema.ts`, `suscripciones-push.schema.ts` (nuevos) | |
| `src/db/schema/usuarios.schema.ts` | H6: `check()` |
| `drizzle/0006_*.sql` (generado y editado) | Tablas nuevas + siembra de turnos |
| `scripts/vapid-generate.ts` (nuevo) | Genera las claves VAPID |
| `src/modules/despachos/despachos.service.ts`, `despachos-excel.service.ts` | H1, H2, H7, H9 |
| `src/modules/precios-combustible/*`, `src/modules/gasolineras/*` | Permisos de `jefe_pista`, H9, turnos por defecto |
| `src/modules/reportes/reportes.service.ts`, `src/modules/saldos/saldos.service.ts` | H9 (filtros por fecha GT) |
| `test/fase6.e2e-spec.ts` (nuevo) | e2e de turnos, push, recordatorios y permisos |
| `test/gasfuel.e2e-spec.ts` | Fechas GT, H1, H2, H7 |
| `docs/contrato-frontend.md`, `CLAUDE.md`, `.env.example` | Documentación |

---

### Tarea 0: Línea base

- [ ] **Paso 1:** Levantar la BD y aplicar las migraciones existentes.

```bash
cd gasolineras-os-backend
docker compose up -d postgres
pnpm db:migrate
```

- [ ] **Paso 2:** Confirmar la línea base en verde. Esperado: `Tests: 156 passed` entre las dos suites y 1 unit test.

```bash
pnpm test
pnpm test:e2e
```

Si algo falla aquí, detenerse y avisar: no se empieza sobre una base roja.

---

### Tarea 1: Hora de Guatemala compartida y corrección de fechas (H9)

**Files:**
- Create: `src/common/hora-guatemala.ts`
- Test: `src/common/hora-guatemala.spec.ts`
- Modify: `src/modules/despachos/despachos.service.ts` (`getGuatemalaTime`, `today` en `create`, filtros de fecha en `findAll`)
- Modify: `src/modules/despachos/despachos-excel.service.ts:60-68`
- Modify: `src/modules/precios-combustible/precios-combustible.service.ts:29-39`
- Modify: `src/modules/reportes/reportes.service.ts:28-35`
- Modify: `src/modules/saldos/saldos.service.ts:55-62,105-120`
- Modify: `test/gasfuel.e2e-spec.ts` (líneas 555, 751, 975-976)

**Interfaces:**
- Produces:
  - `ahoraGuatemala(ahoraUtc?: Date): { fecha: string; minutos: number; diaSemana: number }`, donde `fecha` es `YYYY-MM-DD`, `minutos` va de 0 a 1439 y `diaSemana` de 0 (domingo) a 6.
  - `fechaGuatemala(ahoraUtc?: Date): string`
  - `sumarDias(fecha: string, dias: number): string`
  - `aMinutos(hhmm: string): number`, que acepta `HH:mm` y `HH:mm:ss`.
  - `fechaGtSql(col: AnyColumn): SQL`, que equivale a `(col - INTERVAL '6 hours')::date`.

- [ ] **Paso 1: Escribir el test que falla**

```ts
// src/common/hora-guatemala.spec.ts
import {
  ahoraGuatemala,
  aMinutos,
  fechaGuatemala,
  sumarDias,
} from "./hora-guatemala";

describe("hora-guatemala", () => {
  it("a las 05:59 UTC todavía es el día anterior en Guatemala", () => {
    const r = ahoraGuatemala(new Date("2026-09-26T05:59:00Z"));
    expect(r.fecha).toBe("2026-09-25");
    expect(r.minutos).toBe(23 * 60 + 59);
  });

  it("a las 06:00 UTC ya es medianoche del día siguiente en Guatemala", () => {
    const r = ahoraGuatemala(new Date("2026-09-26T06:00:00Z"));
    expect(r.fecha).toBe("2026-09-26");
    expect(r.minutos).toBe(0);
  });

  it("de 18:00 a 23:59 GT la fecha GT difiere de la UTC (bug H9)", () => {
    // 20:00 GT del 25 = 02:00 UTC del 26
    const ahora = new Date("2026-09-26T02:00:00Z");
    expect(ahora.toISOString().slice(0, 10)).toBe("2026-09-26");
    expect(fechaGuatemala(ahora)).toBe("2026-09-25");
  });

  it("diaSemana usa el calendario de Guatemala", () => {
    // 2026-09-27 es domingo; a las 03:00 UTC del 27 en GT sigue siendo sábado 26
    expect(ahoraGuatemala(new Date("2026-09-27T03:00:00Z")).diaSemana).toBe(6);
  });

  it("sumarDias cruza fin de mes y de año", () => {
    expect(sumarDias("2026-09-30", 1)).toBe("2026-10-01");
    expect(sumarDias("2026-12-31", 1)).toBe("2027-01-01");
    expect(sumarDias("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("aMinutos acepta HH:mm y HH:mm:ss", () => {
    expect(aMinutos("06:30")).toBe(390);
    expect(aMinutos("23:59:00")).toBe(1439);
  });
});
```

- [ ] **Paso 2: Verificar que falla**

Run: `pnpm test -- --testPathPatterns=hora-guatemala`
Expected: FAIL, `Cannot find module './hora-guatemala'`.

- [ ] **Paso 3: Implementar**

```ts
// src/common/hora-guatemala.ts
import { sql, type AnyColumn, type SQL } from "drizzle-orm";

/**
 * Hora de Guatemala: UTC−6 fijo. Guatemala no tiene horario de verano, así
 * que un desfase constante es exacto; no usamos AT TIME ZONE para que la
 * aritmética sea idéntica en JS y en SQL.
 *
 * Todo "hoy" del negocio (precio del día, filtros por fecha, recordatorios)
 * sale de aquí. `new Date().toISOString()` da la fecha UTC, que de 18:00 a
 * 23:59 en Guatemala ya es mañana.
 */
const DESFASE_MS = 6 * 3600 * 1000;

export function ahoraGuatemala(ahoraUtc: Date = new Date()): {
  fecha: string;
  minutos: number;
  diaSemana: number;
} {
  const gt = new Date(ahoraUtc.getTime() - DESFASE_MS);
  return {
    fecha: gt.toISOString().slice(0, 10),
    minutos: gt.getUTCHours() * 60 + gt.getUTCMinutes(),
    diaSemana: gt.getUTCDay(),
  };
}

export function fechaGuatemala(ahoraUtc: Date = new Date()): string {
  return ahoraGuatemala(ahoraUtc).fecha;
}

export function sumarDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

export function aMinutos(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/** Fecha de Guatemala de una columna timestamp guardada en UTC. */
export function fechaGtSql(col: AnyColumn): SQL {
  return sql`(${col} - INTERVAL '6 hours')::date`;
}
```

- [ ] **Paso 4: Verificar que pasa**

Run: `pnpm test -- --testPathPatterns=hora-guatemala`
Expected: PASS (6 tests).

- [ ] **Paso 5: Usar el helper en despachos**

En `despachos.service.ts`, reemplazar `GT_DAYS`/`getGuatemalaTime()`/`hhmm()` por el helper, sin cambiar el comportamiento:

```ts
import {
  ahoraGuatemala,
  aMinutos,
  fechaGuatemala,
  fechaGtSql,
} from "../../common/hora-guatemala";

const GT_DAYS = ["domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"];

function getGuatemalaTime(): { dayName: string; totalMinutes: number } {
  const { diaSemana, minutos } = ahoraGuatemala();
  return { dayName: GT_DAYS[diaSemana], totalMinutes: minutos };
}
```

Borrar la función `hhmm` local y reemplazar sus usos por `aMinutos`. En `create` (línea ~369):

```ts
    // Fecha de Guatemala, no UTC: de 18:00 a 23:59 la fecha UTC ya es mañana y
    // el despacho buscaría un precio que nadie cargó todavía.
    const today = fechaGuatemala();
```

En `findAll` (líneas ~144-151):

```ts
    if (rest.fecha_desde)
      conditions.push(
        sql`${fechaGtSql(despachos.despachado_at)} >= ${rest.fecha_desde}::date`,
      );
    if (rest.fecha_hasta)
      conditions.push(
        sql`${fechaGtSql(despachos.despachado_at)} <= ${rest.fecha_hasta}::date`,
      );
```

- [ ] **Paso 6: Mismo cambio de filtros** en `despachos-excel.service.ts:60-68` y `reportes.service.ts:28-35` (con `despachos.despachado_at`), y en `saldos.service.ts` (con `movimientosSaldo.created_at`, las cinco comparaciones de las líneas 55-62 y 105-120). Las comparaciones contra columnas `date` de `cuadres` (líneas 226-230) **no** se tocan: ya son fechas.

- [ ] **Paso 7: `findHoy` con fecha GT.** En `precios-combustible.service.ts`:

```ts
import { fechaGuatemala } from "../../common/hora-guatemala";
// …
  findHoy(gasolineraId: string) {
    const today = fechaGuatemala();
```

- [ ] **Paso 8: Los e2e usan la misma fecha.** En `test/gasfuel.e2e-spec.ts`, importar `import { fechaGuatemala, sumarDias } from "../src/common/hora-guatemala";` y reemplazar:
  - Línea 555 y 751: `const today = fechaGuatemala();`
  - Líneas 975-976: `const hoy = fechaGuatemala();` y `const ayer = sumarDias(hoy, -1);`

  Buscar otras apariciones con `grep -n "toISOString().split" test/*.ts` y reemplazarlas igual.

- [ ] **Paso 9: Verificar**

Run: `pnpm test && pnpm test:e2e`
Expected: PASS, mismos 156 e2e.

- [ ] **Paso 10: Commit**

```bash
git add src/common/hora-guatemala.ts src/common/hora-guatemala.spec.ts src/modules/despachos src/modules/precios-combustible src/modules/reportes src/modules/saldos test/gasfuel.e2e-spec.ts
git commit -m "fix: usa la fecha de Guatemala para precio del día y filtros por fecha

De 18:00 a 23:59 en Guatemala la fecha UTC ya es mañana: el despacho
buscaba el precio del día siguiente y fallaba con 'No hay precio
registrado', y los filtros por fecha movían los despachos nocturnos al
día siguiente. Se centraliza el cálculo en src/common/hora-guatemala.ts
y los e2e pasan a usar la misma fecha."
```

---

### Tarea 2: Funciones puras de turnos

**Files:**
- Create: `src/modules/turnos/turnos.constants.ts`
- Create: `src/modules/turnos/turnos.util.ts`
- Test: `src/modules/turnos/turnos.util.spec.ts`

**Interfaces:**
- Consumes: `ahoraGuatemala`, `aMinutos`, `sumarDias` (Tarea 1).
- Produces:
  - `TURNOS = ["manana", "tarde"] as const`, `type Turno = (typeof TURNOS)[number]`
  - `TURNOS_POR_DEFECTO: { turno: Turno; hora_inicio: string; hora_fin: string }[]`
  - `NOMBRE_TURNO: Record<Turno, string>` = `{ manana: "Mañana", tarde: "Tarde" }`
  - `segmentos(inicio: string, fin: string): [number, number][]`
  - `seSolapan(a: {hora_inicio: string; hora_fin: string}, b: {hora_inicio: string; hora_fin: string}): boolean`
  - `turnoEnMinuto<T extends {turno: Turno; hora_inicio: string; hora_fin: string}>(turnos: T[], minuto: number): T | null`
  - `debeRecordar(ahoraUtc: Date, horaInicio: string): { fecha: string } | null`
  - `MINUTOS_ANTES = 30`

- [ ] **Paso 1: Escribir el test que falla**

```ts
// src/modules/turnos/turnos.util.spec.ts
import {
  debeRecordar,
  segmentos,
  seSolapan,
  turnoEnMinuto,
} from "./turnos.util";

// Construye un instante UTC a partir de una hora de Guatemala (UTC−6).
const gt = (fecha: string, hhmm: string) =>
  new Date(new Date(`${fecha}T${hhmm}:00Z`).getTime() + 6 * 3600 * 1000);

describe("segmentos", () => {
  it("un turno normal es un solo segmento", () => {
    expect(segmentos("06:00", "14:00")).toEqual([[360, 840]]);
  });
  it("un turno que cruza la medianoche se parte en dos", () => {
    expect(segmentos("18:00", "06:00")).toEqual([
      [1080, 1440],
      [0, 360],
    ]);
  });
});

describe("seSolapan", () => {
  const t = (hora_inicio: string, hora_fin: string) => ({ hora_inicio, hora_fin });
  it("turnos contiguos no se solapan", () => {
    expect(seSolapan(t("06:00", "14:00"), t("14:00", "22:00"))).toBe(false);
  });
  it("detecta solapamiento simple", () => {
    expect(seSolapan(t("06:00", "14:30"), t("14:00", "22:00"))).toBe(true);
  });
  it("detecta solapamiento con un turno que cruza la medianoche", () => {
    expect(seSolapan(t("05:00", "14:00"), t("18:00", "06:00"))).toBe(true);
  });
  it("24 h repartidas en dos turnos no se solapan", () => {
    expect(seSolapan(t("06:00", "18:00"), t("18:00", "06:00"))).toBe(false);
  });
});

describe("turnoEnMinuto", () => {
  const turnos = [
    { turno: "manana" as const, hora_inicio: "06:00", hora_fin: "14:00" },
    { turno: "tarde" as const, hora_inicio: "14:00", hora_fin: "02:00" },
  ];
  it("el inicio pertenece al turno y el fin no", () => {
    expect(turnoEnMinuto(turnos, 360)?.turno).toBe("manana");
    expect(turnoEnMinuto(turnos, 840)?.turno).toBe("tarde");
  });
  it("después de la medianoche sigue el turno que la cruza", () => {
    expect(turnoEnMinuto(turnos, 60)?.turno).toBe("tarde");
  });
  it("fuera de todo turno devuelve null", () => {
    expect(turnoEnMinuto(turnos, 180)).toBeNull();
  });
});

describe("debeRecordar", () => {
  it("dispara dentro de los 30 minutos previos", () => {
    expect(debeRecordar(gt("2026-09-25", "13:45"), "14:00")).toEqual({
      fecha: "2026-09-25",
    });
  });
  it("dispara exactamente 30 minutos antes", () => {
    expect(debeRecordar(gt("2026-09-25", "13:30"), "14:00")).not.toBeNull();
  });
  it("no dispara 31 minutos antes", () => {
    expect(debeRecordar(gt("2026-09-25", "13:29"), "14:00")).toBeNull();
  });
  it("no dispara a la hora de inicio ni después", () => {
    expect(debeRecordar(gt("2026-09-25", "14:00"), "14:00")).toBeNull();
    expect(debeRecordar(gt("2026-09-25", "14:10"), "14:00")).toBeNull();
  });
  it("si el backend levanta a mitad de la ventana, igual dispara", () => {
    expect(debeRecordar(gt("2026-09-25", "13:59"), "14:00")).not.toBeNull();
  });
  it("turno a las 00:15 evaluado a las 23:50: fecha del día siguiente", () => {
    expect(debeRecordar(gt("2026-09-25", "23:50"), "00:15")).toEqual({
      fecha: "2026-09-26",
    });
  });
  it("turno a las 00:00 evaluado a las 23:30 del 31 de diciembre", () => {
    expect(debeRecordar(gt("2026-12-31", "23:30"), "00:00")).toEqual({
      fecha: "2027-01-01",
    });
  });
});
```

- [ ] **Paso 2: Verificar que falla**

Run: `pnpm test -- --testPathPatterns=turnos.util`
Expected: FAIL, `Cannot find module './turnos.util'`.

- [ ] **Paso 3: Implementar**

```ts
// src/modules/turnos/turnos.constants.ts
export const TURNOS = ["manana", "tarde"] as const;
export type Turno = (typeof TURNOS)[number];

export const NOMBRE_TURNO: Record<Turno, string> = {
  manana: "Mañana",
  tarde: "Tarde",
};

/** Horario con el que nace toda gasolinera; el admin lo ajusta después. */
export const TURNOS_POR_DEFECTO: {
  turno: Turno;
  hora_inicio: string;
  hora_fin: string;
}[] = [
  { turno: "manana", hora_inicio: "06:00", hora_fin: "14:00" },
  { turno: "tarde", hora_inicio: "14:00", hora_fin: "22:00" },
];
```

```ts
// src/modules/turnos/turnos.util.ts
import { ahoraGuatemala, aMinutos, sumarDias } from "../../common/hora-guatemala";
import type { Turno } from "./turnos.constants";

export const MINUTOS_ANTES = 30;
const DIA = 1440;

interface Horario {
  hora_inicio: string;
  hora_fin: string;
}

/**
 * Intervalos [desde, hasta) en minutos del día. Un turno cuyo fin es menor
 * que su inicio cruza la medianoche y se parte en dos.
 */
export function segmentos(inicio: string, fin: string): [number, number][] {
  const a = aMinutos(inicio);
  const b = aMinutos(fin);
  return b > a ? [[a, b]] : [[a, DIA], [0, b]];
}

export function seSolapan(x: Horario, y: Horario): boolean {
  const sx = segmentos(x.hora_inicio, x.hora_fin);
  const sy = segmentos(y.hora_inicio, y.hora_fin);
  return sx.some(([a1, a2]) => sy.some(([b1, b2]) => a1 < b2 && b1 < a2));
}

export function turnoEnMinuto<T extends Horario & { turno: Turno }>(
  turnos: T[],
  minuto: number,
): T | null {
  return (
    turnos.find((t) =>
      segmentos(t.hora_inicio, t.hora_fin).some(
        ([a, b]) => minuto >= a && minuto < b,
      ),
    ) ?? null
  );
}

/**
 * ¿Toca avisar ahora del próximo inicio de este turno?
 *
 * Ventana y no minuto exacto: si el backend estuvo caído a las 13:30 y levanta
 * a las 13:41, el aviso de las 14:00 igual sale. La idempotencia la pone el
 * índice único de recordatorios_turno, no esta función.
 *
 * Devuelve la fecha de Guatemala del día en que ARRANCA el turno: un turno de
 * las 00:15 avisado a las 23:45 pertenece al día siguiente.
 */
export function debeRecordar(
  ahoraUtc: Date,
  horaInicio: string,
): { fecha: string } | null {
  const { fecha, minutos } = ahoraGuatemala(ahoraUtc);
  let faltan = aMinutos(horaInicio) - minutos;
  let fechaInicio = fecha;
  if (faltan <= 0) {
    faltan += DIA;
    fechaInicio = sumarDias(fecha, 1);
  }
  return faltan <= MINUTOS_ANTES ? { fecha: fechaInicio } : null;
}
```

- [ ] **Paso 4: Verificar que pasa**

Run: `pnpm test -- --testPathPatterns=turnos.util`
Expected: PASS (16 tests).

- [ ] **Paso 5: Commit**

```bash
git add src/modules/turnos
git commit -m "feat(turnos): funciones puras de horario, solapamiento y ventana de aviso

Se separan de Nest y de la BD para probar los bordes (medianoche, fin de
año, backend que levanta a mitad de la ventana) sin reloj real."
```

---

### Tarea 3: Esquema, migración 0006 y turnos por defecto (incluye H6)

**Files:**
- Create: `src/db/schema/turnos-gasolinera.schema.ts`, `recordatorios-turno.schema.ts`, `suscripciones-push.schema.ts`
- Modify: `src/db/schema/index.ts`, `src/db/schema/usuarios.schema.ts`
- Create (generado): `drizzle/0006_*.sql` y `drizzle/meta/0006_snapshot.json`
- Modify: `src/modules/gasolineras/gasolineras.service.ts` (`create`)

**Interfaces:**
- Produces: tablas Drizzle `turnosGasolinera`, `recordatoriosTurno`, `suscripcionesPush`, con los nombres de columna de la spec §1.1 y §2.1.
- Consumes: `TURNOS_POR_DEFECTO` (Tarea 2).

- [ ] **Paso 1: Esquemas**

```ts
// src/db/schema/turnos-gasolinera.schema.ts
import {
  pgTable,
  uuid,
  varchar,
  time,
  boolean,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { gasolineras } from "./gasolineras.schema";

/**
 * Horario de los dos turnos de cada gasolinera. Siempre exactamente una fila
 * por (gasolinera, turno): la crea la migración para las existentes y
 * GasolinerasService.create para las nuevas. `hora_fin < hora_inicio` es
 * válido y significa que el turno cruza la medianoche.
 */
export const turnosGasolinera = pgTable(
  "turnos_gasolinera",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    gasolinera_id: uuid("gasolinera_id")
      .notNull()
      .references(() => gasolineras.id),
    // 'manana' | 'tarde', el mismo vocabulario que despachos.turno.
    turno: varchar("turno").notNull(),
    hora_inicio: time("hora_inicio").notNull(),
    hora_fin: time("hora_fin").notNull(),
    recordatorio_activo: boolean("recordatorio_activo").notNull().default(true),
    updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    uniqueIndex("turnos_gasolinera_gasolinera_turno_idx").on(
      t.gasolinera_id,
      t.turno,
    ),
  ],
);
```

```ts
// src/db/schema/recordatorios-turno.schema.ts
import {
  pgTable,
  uuid,
  varchar,
  date,
  integer,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { gasolineras } from "./gasolineras.schema";

/**
 * Un aviso enviado por (gasolinera, turno, fecha). El índice único es el
 * candado de idempotencia: quien logra insertar, envía; los demás ticks o
 * instancias ven el conflicto y se saltan el turno.
 */
export const recordatoriosTurno = pgTable(
  "recordatorios_turno",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    gasolinera_id: uuid("gasolinera_id")
      .notNull()
      .references(() => gasolineras.id),
    turno: varchar("turno").notNull(),
    // Fecha de Guatemala del día en que arranca el turno.
    fecha: date("fecha").notNull(),
    enviado_en: timestamp("enviado_en", { withTimezone: true }).defaultNow(),
    correos_enviados: integer("correos_enviados").notNull().default(0),
    push_enviados: integer("push_enviados").notNull().default(0),
  },
  (t) => [
    uniqueIndex("recordatorios_turno_unico_idx").on(
      t.gasolinera_id,
      t.turno,
      t.fecha,
    ),
  ],
);
```

```ts
// src/db/schema/suscripciones-push.schema.ts
import { pgTable, uuid, text, varchar, timestamp } from "drizzle-orm/pg-core";
import { usuarios } from "./usuarios.schema";

/**
 * Una suscripción de Web Push por navegador. `endpoint` es único: si otro
 * usuario inicia sesión en el mismo navegador y se suscribe, la fila se
 * reasigna en vez de duplicarse (el navegador sólo tiene un endpoint).
 */
export const suscripcionesPush = pgTable("suscripciones_push", {
  id: uuid("id").primaryKey().defaultRandom(),
  usuario_id: uuid("usuario_id")
    .notNull()
    .references(() => usuarios.id, { onDelete: "cascade" }),
  endpoint: text("endpoint").notNull().unique(),
  p256dh: varchar("p256dh").notNull(),
  auth: varchar("auth").notNull(),
  user_agent: varchar("user_agent"),
  created_at: timestamp("created_at", { withTimezone: true }).defaultNow(),
});
```

Agregar a `src/db/schema/index.ts`:

```ts
export * from "./turnos-gasolinera.schema";
export * from "./recordatorios-turno.schema";
export * from "./suscripciones-push.schema";
```

- [ ] **Paso 2: H6, declarar el CHECK existente.** En `usuarios.schema.ts`, importar `check` de `drizzle-orm/pg-core` y `sql` de `drizzle-orm`, y agregar el tercer argumento a `pgTable`:

```ts
  },
  // Ya existe en la BD desde 0001 (escrito a mano). Se declara aquí para que
  // el snapshot de Drizzle lo conozca y db:generate no lo omita ni lo duplique.
  (t) => [
    check(
      "usuarios_email_o_telefono_chk",
      sql`${t.email} IS NOT NULL OR ${t.telefono} IS NOT NULL`,
    ),
  ],
);
```

(Cerrar el objeto de columnas antes con `},` y mover el `);` final.) Actualizar el comentario de la columna `email` para que diga "(CHECK declarado abajo)".

- [ ] **Paso 3: Generar la migración**

Run: `pnpm db:generate`
Expected: se crea `drizzle/0006_<nombre>.sql` con tres `CREATE TABLE`, sus FKs e índices, **y** una línea `ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_email_o_telefono_chk" …`.

- [ ] **Paso 4: Editar el SQL generado**

1. **Borrar** la línea `ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_email_o_telefono_chk" …` (y su `--> statement-breakpoint`). El constraint ya existe desde `0001` y aplicarlo otra vez falla. El snapshot se queda como está.
2. **Agregar al final** la siembra:

```sql
--> statement-breakpoint
-- Turnos por defecto para las gasolineras existentes. Las nuevas los reciben
-- en GasolinerasService.create. Mismo horario que TURNOS_POR_DEFECTO.
INSERT INTO "turnos_gasolinera" ("gasolinera_id", "turno", "hora_inicio", "hora_fin")
SELECT "id", 'manana', '06:00', '14:00' FROM "gasolineras"
UNION ALL
SELECT "id", 'tarde', '14:00', '22:00' FROM "gasolineras"
ON CONFLICT DO NOTHING;
```

- [ ] **Paso 5: Aplicar y comprobar que no queda diferencia**

```bash
pnpm db:migrate
pnpm db:generate
```

Expected: el segundo `db:generate` responde `No schema changes, nothing to migrate`. Si genera un `0007`, borrarlo (`.sql`, snapshot y su entrada en `_journal.json`) y revisar el Paso 4.

Verificar la siembra:

```bash
docker compose exec postgres psql -U gasfuel_user -d gasfuel_db -c "SELECT turno, count(*) FROM turnos_gasolinera GROUP BY turno;"
```

Expected: `manana` y `tarde`, cada uno con tantas filas como gasolineras.

- [ ] **Paso 6: Turnos por defecto al crear una gasolinera.** En `gasolineras.service.ts`:

```ts
import { gasolineras, turnosGasolinera } from "../../db/schema";
import { TURNOS_POR_DEFECTO } from "../turnos/turnos.constants";
// …
  async create(dto: CreateGasolineraDto) {
    // En la misma transacción: una gasolinera sin sus dos turnos rompería el
    // turno vigente del formulario y los recordatorios.
    return this.db.db.transaction(async (tx) => {
      const [row] = await tx.insert(gasolineras).values(dto).returning();
      await tx.insert(turnosGasolinera).values(
        TURNOS_POR_DEFECTO.map((t) => ({ ...t, gasolinera_id: row.id })),
      );
      return row;
    });
  }
```

- [ ] **Paso 7: Verificar**

Run: `pnpm build && pnpm test:e2e`
Expected: build limpio, 156 e2e en verde (la sección 2 crea gasolineras y ahora también sus turnos).

- [ ] **Paso 8: Commit**

```bash
git add src/db/schema drizzle src/modules/gasolineras/gasolineras.service.ts
git commit -m "feat(db): tablas de turnos, recordatorios y suscripciones push

Migración 0006 con turnos_gasolinera (sembrada con 06:00-14:00 y
14:00-22:00 para cada gasolinera), recordatorios_turno (índice único como
candado de idempotencia) y suscripciones_push. Toda gasolinera nueva nace
con sus dos turnos en la misma transacción.

Además se declara en usuarios.schema.ts el CHECK email-o-teléfono que
sólo existía en el SQL de 0001, para que el snapshot deje de omitirlo."
```

---

### Tarea 4: Módulo de turnos (endpoints)

**Files:**
- Create: `src/modules/turnos/dto/update-turno.dto.ts`
- Create: `src/modules/turnos/turnos.service.ts`
- Create: `src/modules/turnos/turnos.controller.ts`
- Create: `src/modules/turnos/turnos.module.ts`
- Modify: `src/app.module.ts`
- Create: `test/fase6.e2e-spec.ts`

**Interfaces:**
- Consumes: `turnosGasolinera` (Tarea 3), `seSolapan`, `turnoEnMinuto`, `TURNOS`, `Turno` (Tarea 2), `ahoraGuatemala` (Tarea 1).
- Produces:
  - `TurnosService.listar(gasolineraId: string): Promise<FilaTurno[]>`
  - `TurnosService.actualizar(gasolineraId: string, turno: string, dto: UpdateTurnoDto): Promise<FilaTurno>`
  - `TurnosService.turnoActual(gasolineraId: string, ahoraUtc?: Date): Promise<{ turno: Turno | null }>`
  - `type FilaTurno = { id: string; gasolinera_id: string; turno: Turno; hora_inicio: string /*HH:mm*/; hora_fin: string; recordatorio_activo: boolean; updated_at: Date | null }`
  - `aFila(row): FilaTurno`, exportada (la usa la Tarea 8).
  - HTTP según spec §1.2.
  - Helpers del e2e en `test/fase6.e2e-spec.ts`: `crearUsuario(rol, extra)` y `loginToken(identificador)`.

- [ ] **Paso 1: Escribir el e2e que falla (bootstrap + turnos)**

```ts
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
import { gasolineras, turnosGasolinera, usuarios } from "../src/db/schema";

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
      // B: turno de mañana que cubre todo el día salvo un minuto
      await db.db
        .update(turnosGasolinera)
        .set({ hora_inicio: "00:00", hora_fin: "23:59" })
        .where(and(eq(turnosGasolinera.gasolinera_id, gasBId), eq(turnosGasolinera.turno, "manana")));
      await db.db
        .update(turnosGasolinera)
        .set({ hora_inicio: "23:59", hora_fin: "00:00" })
        .where(and(eq(turnosGasolinera.gasolinera_id, gasBId), eq(turnosGasolinera.turno, "tarde")));

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
});
```

- [ ] **Paso 2: Verificar que falla**

Run: `pnpm test:e2e -- --testPathPatterns=fase6`
Expected: FAIL, 404 en `GET /api/v1/gasolineras/:id/turnos`.

- [ ] **Paso 3: DTO**

```ts
// src/modules/turnos/dto/update-turno.dto.ts
import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsBoolean, IsOptional, Matches } from "class-validator";

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export class UpdateTurnoDto {
  @ApiPropertyOptional({ example: "06:00" })
  @IsOptional()
  @Matches(HHMM, { message: "hora_inicio debe tener formato HH:mm (24 h)" })
  hora_inicio?: string;

  @ApiPropertyOptional({ example: "14:00" })
  @IsOptional()
  @Matches(HHMM, { message: "hora_fin debe tener formato HH:mm (24 h)" })
  hora_fin?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  recordatorio_activo?: boolean;
}
```

- [ ] **Paso 4: Servicio**

```ts
// src/modules/turnos/turnos.service.ts
import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { and, asc, eq } from "drizzle-orm";
import { DbService } from "../../db/db.service";
import { turnosGasolinera } from "../../db/schema";
import { ahoraGuatemala } from "../../common/hora-guatemala";
import { TURNOS, type Turno } from "./turnos.constants";
import { seSolapan, turnoEnMinuto } from "./turnos.util";
import { UpdateTurnoDto } from "./dto/update-turno.dto";

export interface FilaTurno {
  id: string;
  gasolinera_id: string;
  turno: Turno;
  hora_inicio: string;
  hora_fin: string;
  recordatorio_activo: boolean;
  updated_at: Date | null;
}

/** Postgres devuelve `time` como "06:00:00"; el contrato habla en HH:mm. */
export function aFila(row: typeof turnosGasolinera.$inferSelect): FilaTurno {
  return {
    ...row,
    turno: row.turno as Turno,
    hora_inicio: row.hora_inicio.slice(0, 5),
    hora_fin: row.hora_fin.slice(0, 5),
  };
}

@Injectable()
export class TurnosService {
  constructor(private db: DbService) {}

  async listar(gasolineraId: string): Promise<FilaTurno[]> {
    const rows = await this.db.db
      .select()
      .from(turnosGasolinera)
      .where(eq(turnosGasolinera.gasolinera_id, gasolineraId))
      // 'manana' < 'tarde' alfabéticamente: el orden sale gratis.
      .orderBy(asc(turnosGasolinera.turno));
    if (!rows.length) throw new NotFoundException("Gasolinera no encontrada");
    return rows.map(aFila);
  }

  async actualizar(gasolineraId: string, turno: string, dto: UpdateTurnoDto): Promise<FilaTurno> {
    if (!(TURNOS as readonly string[]).includes(turno)) {
      throw new BadRequestException("El turno debe ser 'manana' o 'tarde'");
    }
    if (
      dto.hora_inicio === undefined &&
      dto.hora_fin === undefined &&
      dto.recordatorio_activo === undefined
    ) {
      throw new BadRequestException("No hay cambios que guardar");
    }

    const turnos = await this.listar(gasolineraId);
    const actual = turnos.find((t) => t.turno === turno)!;
    const otro = turnos.find((t) => t.turno !== turno)!;
    const nuevo = {
      hora_inicio: dto.hora_inicio ?? actual.hora_inicio,
      hora_fin: dto.hora_fin ?? actual.hora_fin,
    };

    if (nuevo.hora_inicio === nuevo.hora_fin) {
      throw new BadRequestException("La hora de inicio y la de fin no pueden ser iguales");
    }
    if (seSolapan(nuevo, otro)) {
      throw new BadRequestException(
        `El turno se solapa con el turno ${otro.turno === "manana" ? "de la mañana" : "de la tarde"} (${otro.hora_inicio}–${otro.hora_fin})`,
      );
    }

    const [row] = await this.db.db
      .update(turnosGasolinera)
      .set({ ...nuevo, recordatorio_activo: dto.recordatorio_activo ?? actual.recordatorio_activo, updated_at: new Date() })
      .where(and(eq(turnosGasolinera.gasolinera_id, gasolineraId), eq(turnosGasolinera.turno, turno)))
      .returning();
    return aFila(row);
  }

  async turnoActual(gasolineraId: string, ahoraUtc: Date = new Date()): Promise<{ turno: Turno | null }> {
    const turnos = await this.listar(gasolineraId);
    const hit = turnoEnMinuto(turnos, ahoraGuatemala(ahoraUtc).minutos);
    return { turno: hit?.turno ?? null };
  }
}
```

- [ ] **Paso 5: Controller**

```ts
// src/modules/turnos/turnos.controller.ts
import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query, Request } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from "@nestjs/swagger";
import { Auth } from "../../auth/roles.decorator";
import { TurnosService } from "./turnos.service";
import { UpdateTurnoDto } from "./dto/update-turno.dto";

@ApiTags("turnos")
@ApiBearerAuth("JWT")
@Controller()
export class TurnosController {
  constructor(private readonly service: TurnosService) {}

  @Get("gasolineras/:id/turnos")
  @Auth("admin", "supervisor", "jefe_pista")
  @ApiOperation({ summary: "Horario de los dos turnos de una gasolinera" })
  listar(@Param("id", ParseUUIDPipe) id: string) {
    return this.service.listar(id);
  }

  @Patch("gasolineras/:id/turnos/:turno")
  @Auth("admin")
  @ApiOperation({ summary: "Editar horario o recordatorio de un turno" })
  actualizar(
    @Param("id", ParseUUIDPipe) id: string,
    @Param("turno") turno: string,
    @Body() dto: UpdateTurnoDto,
  ) {
    return this.service.actualizar(id, turno, dto);
  }

  @Get("turnos/actual")
  @Auth("admin", "supervisor")
  @ApiOperation({ summary: "Turno vigente según la hora de Guatemala" })
  @ApiQuery({ name: "gasolinera_id", required: false })
  actual(@Request() req: any, @Query("gasolinera_id") gasolineraId?: string) {
    // El supervisor sólo opera su gasolinera: el query se ignora.
    const id = req.user.rol === "supervisor" ? req.user.gasolinera_id : gasolineraId;
    if (!id) throw new BadRequestException("Falta gasolinera_id");
    return this.service.turnoActual(id);
  }
}
```

- [ ] **Paso 6: Módulo y registro**

```ts
// src/modules/turnos/turnos.module.ts
import { Module } from "@nestjs/common";
import { TurnosController } from "./turnos.controller";
import { TurnosService } from "./turnos.service";

@Module({
  controllers: [TurnosController],
  providers: [TurnosService],
  exports: [TurnosService],
})
export class TurnosModule {}
```

En `app.module.ts`, importar `TurnosModule` y agregarlo a `imports` después de `VentasInsumosModule`.

- [ ] **Paso 7: Verificar**

Run: `pnpm test:e2e -- --testPathPatterns=fase6`
Expected: PASS.

- [ ] **Paso 8: Commit**

```bash
git add src/modules/turnos src/app.module.ts test/fase6.e2e-spec.ts
git commit -m "feat(turnos): endpoints de horario por gasolinera y turno vigente

GET/PATCH /gasolineras/:id/turnos y GET /turnos/actual. El PATCH valida
formato HH:mm, inicio distinto de fin y que no se solape con el otro
turno, incluidos los que cruzan la medianoche."
```

---

### Tarea 5: El jefe de pista puede leer precios y gasolineras

**Files:**
- Modify: `src/modules/precios-combustible/precios-combustible.controller.ts`
- Modify: `src/modules/gasolineras/gasolineras.controller.ts`
- Test: `test/fase6.e2e-spec.ts`

**Interfaces:**
- Produces: `GET /precios-combustible/hoy?gasolinera_id=` (el query se ignora para el supervisor).

- [ ] **Paso 1: Tests que fallan.** Agregar al final del `describe` raíz de `test/fase6.e2e-spec.ts`:

```ts
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
      const res = await http()
        .get(`/api/v1/precios-combustible/hoy?gasolinera_id=${gasBId}`)
        .set("Authorization", `Bearer ${supervisorToken}`);
      expect(res.status).toBe(200);
      expect(res.body.every((p: any) => p.gasolinera_id === gasAId)).toBe(true);
    });

    it("/hoy sin gasolinera_id para admin → 400", async () => {
      const res = await http().get("/api/v1/precios-combustible/hoy").set("Authorization", `Bearer ${adminToken}`);
      expect(res.status).toBe(400);
    });
  });
```

Agregar `import { fechaGuatemala } from "../src/common/hora-guatemala";` arriba. Verificar antes con `sed -n 1,40p src/modules/precios-combustible/dto/create-precio.dto.ts` que los nombres del body (`precio_galon` como string) coinciden con el DTO y ajustar el test si no.

- [ ] **Paso 2: Verificar que falla**

Run: `pnpm test:e2e -- --testPathPatterns=fase6`
Expected: FAIL con 403 en los tests del jefe.

- [ ] **Paso 3: Implementar.** En `precios-combustible.controller.ts`:

```ts
  @Get()
  @Auth("admin", "supervisor", "jefe_pista")
  // … sin cambios en el cuerpo

  @Get("hoy")
  @Auth("admin", "supervisor", "jefe_pista")
  @ApiOperation({
    summary: "Precios de hoy (hora de Guatemala) de una gasolinera",
  })
  @ApiQuery({ name: "gasolinera_id", required: false })
  findHoy(@Request() req: any, @Query("gasolinera_id") gasolineraId?: string) {
    // El supervisor sólo ve su gasolinera; admin y jefe de pista eligen.
    const id = req.user.rol === "supervisor" ? req.user.gasolinera_id : gasolineraId;
    if (!id) throw new BadRequestException("Falta gasolinera_id");
    return this.service.findHoy(id);
  }
```

(Importar `BadRequestException` de `@nestjs/common`.) En `gasolineras.controller.ts`, cambiar `@Auth("admin", "supervisor")` por `@Auth("admin", "supervisor", "jefe_pista")` en `findAll` y `findOne`. `findAll` ya devuelve todas para cualquier rol distinto de supervisor, así que el jefe ve las dos estaciones.

- [ ] **Paso 4: Verificar**

Run: `pnpm test:e2e`
Expected: PASS en las tres suites.

- [ ] **Paso 5: Commit**

```bash
git add src/modules/precios-combustible src/modules/gasolineras/gasolineras.controller.ts test/fase6.e2e-spec.ts
git commit -m "fix(permisos): el jefe de pista puede leer precios y gasolineras

Podía crear y corregir precios pero no leerlos, así que su pantalla
quedaba vacía. /precios-combustible/hoy acepta gasolinera_id para admin y
jefe; el supervisor sigue limitado a la suya."
```

---

### Tarea 6: Infraestructura de push y suscripciones

**Files:**
- Create: `src/push/push.service.ts`, `src/push/web-push.service.ts`, `src/push/in-memory-push.service.ts`, `src/push/push.module.ts`
- Test: `src/push/web-push.service.spec.ts`
- Create: `src/modules/push/push.controller.ts`, `src/modules/push/suscripciones-push.service.ts`, `src/modules/push/push-suscripciones.module.ts`, `src/modules/push/dto/crear-suscripcion.dto.ts`, `src/modules/push/dto/borrar-suscripcion.dto.ts`
- Create: `scripts/vapid-generate.ts`
- Modify: `package.json`, `src/app.module.ts`, `.env.example`, `test/fase6.e2e-spec.ts`

**Interfaces:**
- Produces:
  - `interface MensajePush { title: string; body: string; url: string }`
  - `interface DestinoPush { endpoint: string; p256dh: string; auth: string }`
  - `type ResultadoPush = "ok" | "expirada" | "error"`
  - `abstract class PushService { abstract clavePublica(): string | null; abstract enviar(destino: DestinoPush, mensaje: MensajePush): Promise<ResultadoPush>; }`
  - `InMemoryPushService` con `enviados: { destino: DestinoPush; mensaje: MensajePush }[]`, `expirados: Set<string>` (endpoints que responden `'expirada'`), `clave: string | null` (por defecto `"clave-publica-de-prueba"`) y `limpiar()`.
  - `SuscripcionesPushService.guardar(usuarioId: string, dto: CrearSuscripcionDto, userAgent?: string)`, `.borrar(usuarioId: string, endpoint: string)`, `.enviarAUsuarios(usuarioIds: string[], mensajePorUsuario: (usuarioId: string) => MensajePush): Promise<number>` (devuelve cuántos push salieron `'ok'` y borra las suscripciones `'expirada'`).

- [ ] **Paso 1: Dependencias**

```bash
pnpm add @nestjs/schedule@12.0.2 web-push@3.6.7
pnpm add -D @types/web-push@3.6.4
```

Verificar que `package.json` quedó con versión exacta (sin `^`); si no, editarlo a mano y correr `pnpm install`.

- [ ] **Paso 2: Unit test de `WebPushService` que falla**

```ts
// src/push/web-push.service.spec.ts
import { ConfigService } from "@nestjs/config";
import * as webpush from "web-push";
import { WebPushService } from "./web-push.service";

jest.mock("web-push", () => ({
  setVapidDetails: jest.fn(),
  sendNotification: jest.fn(),
}));

const config = (vars: Record<string, string | undefined>) =>
  ({ get: (k: string) => vars[k] }) as unknown as ConfigService;

const VAPID = {
  VAPID_PUBLIC_KEY: "pub",
  VAPID_PRIVATE_KEY: "priv",
  VAPID_SUBJECT: "mailto:admin@example.com",
};
const destino = { endpoint: "https://push.example/abc", p256dh: "p", auth: "a" };
const mensaje = { title: "t", body: "b", url: "/jefe" };

describe("WebPushService", () => {
  beforeEach(() => jest.clearAllMocks());

  it("sin VAPID queda desactivado: no expone clave y no envía", async () => {
    const s = new WebPushService(config({}));
    expect(s.clavePublica()).toBeNull();
    expect(await s.enviar(destino, mensaje)).toBe("error");
    expect(webpush.sendNotification).not.toHaveBeenCalled();
  });

  it("con VAPID envía el mensaje como JSON", async () => {
    (webpush.sendNotification as jest.Mock).mockResolvedValue({ statusCode: 201 });
    const s = new WebPushService(config(VAPID));
    expect(s.clavePublica()).toBe("pub");
    expect(await s.enviar(destino, mensaje)).toBe("ok");
    expect(webpush.sendNotification).toHaveBeenCalledWith(
      { endpoint: destino.endpoint, keys: { p256dh: "p", auth: "a" } },
      JSON.stringify(mensaje),
    );
  });

  it.each([404, 410])("un %i marca la suscripción como expirada", async (statusCode) => {
    (webpush.sendNotification as jest.Mock).mockRejectedValue({ statusCode });
    const s = new WebPushService(config(VAPID));
    expect(await s.enviar(destino, mensaje)).toBe("expirada");
  });

  it("un 500 es error, no expirada", async () => {
    (webpush.sendNotification as jest.Mock).mockRejectedValue({ statusCode: 500 });
    const s = new WebPushService(config(VAPID));
    expect(await s.enviar(destino, mensaje)).toBe("error");
  });
});
```

Run: `pnpm test -- --testPathPatterns=web-push`
Expected: FAIL, módulo no encontrado.

- [ ] **Paso 3: Implementar la infraestructura**

```ts
// src/push/push.service.ts
/**
 * Web Push. Se define como clase abstracta, igual que MailService y
 * StorageService, para inyectar un fake en memoria en los tests.
 */
export interface MensajePush {
  title: string;
  body: string;
  /** Ruta del frontend que abre la notificación al tocarla. */
  url: string;
}

export interface DestinoPush {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** 'expirada' = el navegador ya no reconoce la suscripción (404/410): borrarla. */
export type ResultadoPush = "ok" | "expirada" | "error";

export abstract class PushService {
  /** Clave pública VAPID, o null si el push está desactivado. */
  abstract clavePublica(): string | null;
  abstract enviar(destino: DestinoPush, mensaje: MensajePush): Promise<ResultadoPush>;
}
```

```ts
// src/push/web-push.service.ts
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as webpush from "web-push";
import { PushService, type DestinoPush, type MensajePush, type ResultadoPush } from "./push.service";

/**
 * Push real con VAPID. A diferencia del correo y de R2, las claves son
 * opcionales: sin ellas el push queda apagado con un warning y el backend
 * arranca igual. Un recordatorio sin push sigue saliendo por correo.
 */
@Injectable()
export class WebPushService extends PushService {
  private readonly logger = new Logger(WebPushService.name);
  private readonly publica: string | null;

  constructor(config: ConfigService) {
    super();
    const publica = config.get<string>("VAPID_PUBLIC_KEY");
    const privada = config.get<string>("VAPID_PRIVATE_KEY");
    const subject = config.get<string>("VAPID_SUBJECT");
    if (publica && privada && subject) {
      webpush.setVapidDetails(subject, publica, privada);
      this.publica = publica;
    } else {
      this.publica = null;
      this.logger.warn("Push desactivado: faltan VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY o VAPID_SUBJECT.");
    }
  }

  clavePublica(): string | null {
    return this.publica;
  }

  async enviar(destino: DestinoPush, mensaje: MensajePush): Promise<ResultadoPush> {
    if (!this.publica) return "error";
    try {
      await webpush.sendNotification(
        { endpoint: destino.endpoint, keys: { p256dh: destino.p256dh, auth: destino.auth } },
        JSON.stringify(mensaje),
      );
      return "ok";
    } catch (e: any) {
      if (e?.statusCode === 404 || e?.statusCode === 410) return "expirada";
      this.logger.error(`Fallo al enviar push (${e?.statusCode ?? "sin status"})`);
      return "error";
    }
  }
}
```

```ts
// src/push/in-memory-push.service.ts
import { Injectable } from "@nestjs/common";
import { PushService, type DestinoPush, type MensajePush, type ResultadoPush } from "./push.service";

/** Fake en memoria para los tests: guarda lo enviado, sin red ni VAPID. */
@Injectable()
export class InMemoryPushService extends PushService {
  readonly enviados: { destino: DestinoPush; mensaje: MensajePush }[] = [];
  /** Endpoints que simulan una suscripción muerta (404/410). */
  readonly expirados = new Set<string>();
  clave: string | null = "clave-publica-de-prueba";

  clavePublica(): string | null {
    return this.clave;
  }

  enviar(destino: DestinoPush, mensaje: MensajePush): Promise<ResultadoPush> {
    if (this.expirados.has(destino.endpoint)) return Promise.resolve("expirada");
    this.enviados.push({ destino: { ...destino }, mensaje: { ...mensaje } });
    return Promise.resolve("ok");
  }

  limpiar(): void {
    this.enviados.length = 0;
    this.expirados.clear();
  }
}
```

```ts
// src/push/push.module.ts
import { Global, Module } from "@nestjs/common";
import { PushService } from "./push.service";
import { WebPushService } from "./web-push.service";

/** Global como MailModule: los recordatorios inyectan PushService sin importarlo. */
@Global()
@Module({
  providers: [{ provide: PushService, useClass: WebPushService }],
  exports: [PushService],
})
export class PushModule {}
```

Run: `pnpm test -- --testPathPatterns=web-push`
Expected: PASS (5 tests).

- [ ] **Paso 4: e2e de suscripciones que falla.** En `test/fase6.e2e-spec.ts`: agregar a los imports `import { PushService } from "../src/push/push.service"; import { InMemoryPushService } from "../src/push/in-memory-push.service"; import { suscripcionesPush } from "../src/db/schema";`, agregar `.overrideProvider(PushService).useClass(InMemoryPushService)` al builder, declarar `let pushes: InMemoryPushService;` y asignar `pushes = app.get(PushService);` después de `correos`. Luego agregar:

```ts
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
```

Run: `pnpm test:e2e -- --testPathPatterns=fase6`
Expected: FAIL, 404 en `/push/vapid-public-key`.

- [ ] **Paso 5: DTOs, servicio y controller de suscripciones**

```ts
// src/modules/push/dto/crear-suscripcion.dto.ts
import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsNotEmpty, IsString, IsUrl, MaxLength, ValidateNested } from "class-validator";

class ClavesSuscripcionDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(255) p256dh: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(255) auth: string;
}

/** Forma de PushSubscription.toJSON() en el navegador (sin expirationTime). */
export class CrearSuscripcionDto {
  @ApiProperty({ example: "https://fcm.googleapis.com/fcm/send/…" })
  @IsUrl({ protocols: ["https"], require_tld: true })
  @MaxLength(2048)
  endpoint: string;

  @ApiProperty({ type: ClavesSuscripcionDto })
  @ValidateNested()
  @Type(() => ClavesSuscripcionDto)
  keys: ClavesSuscripcionDto;
}
```

```ts
// src/modules/push/dto/borrar-suscripcion.dto.ts
import { ApiProperty } from "@nestjs/swagger";
import { IsString, IsNotEmpty, MaxLength } from "class-validator";

export class BorrarSuscripcionDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(2048) endpoint: string;
}
```

Nota: el navegador puede mandar `expirationTime: null` si el frontend envía `sub.toJSON()` tal cual, y `forbidNonWhitelisted` lo rechazaría. El contrato exige `{ endpoint, keys }`; el plan del frontend arma ese objeto explícitamente.

```ts
// src/modules/push/suscripciones-push.service.ts
import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { and, eq, inArray } from "drizzle-orm";
import { DbService } from "../../db/db.service";
import { suscripcionesPush } from "../../db/schema";
import { PushService, type MensajePush } from "../../push/push.service";
import { CrearSuscripcionDto } from "./dto/crear-suscripcion.dto";

@Injectable()
export class SuscripcionesPushService {
  private readonly logger = new Logger(SuscripcionesPushService.name);

  constructor(private db: DbService, private push: PushService) {}

  async guardar(usuarioId: string, dto: CrearSuscripcionDto, userAgent?: string) {
    // Upsert por endpoint: un navegador tiene un solo endpoint, y si cambia de
    // usuario la suscripción tiene que seguir al que inició sesión ahora.
    await this.db.db
      .insert(suscripcionesPush)
      .values({ usuario_id: usuarioId, endpoint: dto.endpoint, p256dh: dto.keys.p256dh, auth: dto.keys.auth, user_agent: userAgent?.slice(0, 255) })
      .onConflictDoUpdate({
        target: suscripcionesPush.endpoint,
        set: { usuario_id: usuarioId, p256dh: dto.keys.p256dh, auth: dto.keys.auth, user_agent: userAgent?.slice(0, 255) },
      });
    return { ok: true };
  }

  async borrar(usuarioId: string, endpoint: string) {
    const borradas = await this.db.db
      .delete(suscripcionesPush)
      .where(and(eq(suscripcionesPush.endpoint, endpoint), eq(suscripcionesPush.usuario_id, usuarioId)))
      .returning({ id: suscripcionesPush.id });
    if (!borradas.length) throw new NotFoundException("Suscripción no encontrada");
    return { ok: true };
  }

  /** Envía a todas las suscripciones de esos usuarios. Devuelve los envíos 'ok'. */
  async enviarAUsuarios(usuarioIds: string[], mensajePorUsuario: (usuarioId: string) => MensajePush): Promise<number> {
    if (!usuarioIds.length || !this.push.clavePublica()) return 0;
    const subs = await this.db.db.select().from(suscripcionesPush).where(inArray(suscripcionesPush.usuario_id, usuarioIds));
    let ok = 0;
    for (const s of subs) {
      const r = await this.push.enviar(s, mensajePorUsuario(s.usuario_id));
      if (r === "ok") ok++;
      if (r === "expirada") {
        await this.db.db.delete(suscripcionesPush).where(eq(suscripcionesPush.id, s.id));
        this.logger.log(`Suscripción push expirada eliminada (${s.id})`);
      }
    }
    return ok;
  }
}
```

```ts
// src/modules/push/push.controller.ts
import { Body, Controller, Delete, Get, HttpCode, Post, Request } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Auth } from "../../auth/roles.decorator";
import { PushService } from "../../push/push.service";
import { SuscripcionesPushService } from "./suscripciones-push.service";
import { CrearSuscripcionDto } from "./dto/crear-suscripcion.dto";
import { BorrarSuscripcionDto } from "./dto/borrar-suscripcion.dto";

@ApiTags("push")
@Controller("push")
export class PushController {
  constructor(private readonly push: PushService, private readonly service: SuscripcionesPushService) {}

  // Pública a propósito: la clave VAPID pública no es un secreto.
  @Get("vapid-public-key")
  @ApiOperation({ summary: "Clave pública VAPID (null si el push está desactivado)" })
  clave() {
    return { key: this.push.clavePublica() };
  }

  @Post("suscripciones")
  @ApiBearerAuth("JWT")
  @Auth("admin", "jefe_pista")
  @ApiOperation({ summary: "Registrar la suscripción push de este navegador" })
  guardar(@Request() req: any, @Body() dto: CrearSuscripcionDto) {
    return this.service.guardar(req.user.id, dto, req.headers["user-agent"]);
  }

  @Delete("suscripciones")
  @HttpCode(200)
  @ApiBearerAuth("JWT")
  @Auth("admin", "jefe_pista")
  @ApiOperation({ summary: "Eliminar la suscripción push de este navegador" })
  borrar(@Request() req: any, @Body() dto: BorrarSuscripcionDto) {
    return this.service.borrar(req.user.id, dto.endpoint);
  }
}
```

```ts
// src/modules/push/push-suscripciones.module.ts
import { Module } from "@nestjs/common";
import { PushController } from "./push.controller";
import { SuscripcionesPushService } from "./suscripciones-push.service";

@Module({
  controllers: [PushController],
  providers: [SuscripcionesPushService],
  exports: [SuscripcionesPushService],
})
export class PushSuscripcionesModule {}
```

En `app.module.ts`: importar y agregar `PushModule` (después de `MailModule`) y `PushSuscripcionesModule` (después de `TurnosModule`). También hay que agregar `.overrideProvider(PushService).useClass(InMemoryPushService)` en `test/gasfuel.e2e-spec.ts` y `test/auth-rotacion.e2e-spec.ts`, para que las otras suites no dependan de las env vars de VAPID ni muestren el warning. No es estrictamente necesario, porque el servicio real arranca sin claves, pero mantiene las suites aisladas de la red.

- [ ] **Paso 6: Script de claves y `.env.example`**

```ts
// scripts/vapid-generate.ts
import { generateVAPIDKeys } from "web-push";

const { publicKey, privateKey } = generateVAPIDKeys();
console.log(`VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${privateKey}`);
console.log("VAPID_SUBJECT=mailto:tu-correo@dominio.com");
```

En `package.json`, dentro de `scripts`: `"vapid:generate": "ts-node scripts/vapid-generate.ts"`.

Agregar a `.env.example`, después del bloque de Resend:

```bash
# Web Push (recordatorios a admin y jefe de pista). OPCIONALES: sin ellas el
# push queda desactivado y el backend arranca igual (el correo sigue saliendo).
# Generar con: pnpm vapid:generate
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=

# Recordatorio de precios 30 min antes de cada turno. "false" lo apaga
# (útil en desarrollo local). Por defecto está activo.
RECORDATORIOS_ACTIVOS=
```

- [ ] **Paso 7: Verificar**

Run: `pnpm test && pnpm test:e2e && pnpm vapid:generate`
Expected: todo en verde y el script imprime tres líneas `VAPID_*`.

- [ ] **Paso 8: Commit**

```bash
git add package.json pnpm-lock.yaml src/push src/modules/push src/app.module.ts scripts/vapid-generate.ts .env.example test
git commit -m "feat(push): suscripciones Web Push con VAPID opcional

PushService como clase abstracta (WebPushService real, fake en memoria
para e2e), igual que MailService. Sin claves VAPID el push se apaga con
un warning en vez de impedir el arranque. Las suscripciones se guardan
por endpoint (upsert) y las que responden 404/410 se eliminan al enviar."
```

---

### Tarea 7: Mensaje del recordatorio

**Files:**
- Create: `src/modules/turnos/recordatorio.mensaje.ts`
- Test: `src/modules/turnos/recordatorio.mensaje.spec.ts`

**Interfaces:**
- Consumes: `NOMBRE_TURNO`, `Turno` (Tarea 2), `MensajePush` (Tarea 6).
- Produces: `armarRecordatorio(e: { gasolinera: string; turno: Turno; horaInicio: string; precios: { tipo_combustible: string; precio_galon: string }[]; frontendUrl: string; rol: "admin" | "jefe_pista" }): { asunto: string; texto: string; html: string; push: MensajePush }`.

- [ ] **Paso 1: Test que falla**

```ts
// src/modules/turnos/recordatorio.mensaje.spec.ts
import { armarRecordatorio } from "./recordatorio.mensaje";

const base = {
  gasolinera: "La Estación Morales",
  turno: "tarde" as const,
  horaInicio: "14:00",
  frontendUrl: "https://app.example",
  rol: "jefe_pista" as const,
};

describe("armarRecordatorio", () => {
  it("asunto con turno, gasolinera y hora", () => {
    const m = armarRecordatorio({ ...base, precios: [] });
    expect(m.asunto).toBe("Turno Tarde en La Estación Morales empieza a las 14:00: revisa los precios");
  });

  it("lista los precios con nombre legible y formato Q", () => {
    const m = armarRecordatorio({
      ...base,
      precios: [
        { tipo_combustible: "super", precio_galon: "34.750" },
        { tipo_combustible: "diesel", precio_galon: "30.5" },
      ],
    });
    expect(m.texto).toContain("Súper: Q 34.750");
    expect(m.texto).toContain("Diésel: Q 30.500");
    expect(m.push.body).toContain("Súper Q 34.750");
  });

  it("sin precios lo dice explícitamente", () => {
    const m = armarRecordatorio({ ...base, precios: [] });
    expect(m.texto).toContain("Todavía no hay precios cargados para hoy en La Estación Morales.");
    expect(m.push.body).toContain("Sin precios cargados hoy");
  });

  it("enlace según el rol", () => {
    expect(armarRecordatorio({ ...base, precios: [] }).push.url).toBe("/jefe");
    expect(armarRecordatorio({ ...base, rol: "admin", precios: [] }).push.url).toBe("/admin/precios");
    expect(armarRecordatorio({ ...base, precios: [] }).html).toContain('href="https://app.example/jefe"');
  });

  it("escapa el HTML del nombre de la gasolinera", () => {
    const m = armarRecordatorio({ ...base, gasolinera: "<script>x</script>", precios: [] });
    expect(m.html).not.toContain("<script>");
    expect(m.html).toContain("&lt;script&gt;");
  });
});
```

Run: `pnpm test -- --testPathPatterns=recordatorio.mensaje`
Expected: FAIL.

- [ ] **Paso 2: Implementar.** Antes de escribir, revisar `grep -rn "escapar\|escapeHtml" src/` por si la Fase 2 ya tiene un helper de escape en `src/mail/` o `src/auth/password-reset.service.ts`. Si existe, importarlo en vez de definir `escapar` aquí.

```ts
// src/modules/turnos/recordatorio.mensaje.ts
import type { MensajePush } from "../../push/push.service";
import { NOMBRE_TURNO, type Turno } from "./turnos.constants";

const NOMBRE_COMBUSTIBLE: Record<string, string> = {
  super: "Súper",
  regular: "Regular",
  diesel: "Diésel",
  gas_lp: "Gas LP",
};
const ORDEN = ["super", "regular", "diesel", "gas_lp"];

const escapar = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const q = (v: string) => `Q ${Number(v).toFixed(3)}`;

export function armarRecordatorio(e: {
  gasolinera: string;
  turno: Turno;
  horaInicio: string;
  precios: { tipo_combustible: string; precio_galon: string }[];
  frontendUrl: string;
  rol: "admin" | "jefe_pista";
}): { asunto: string; texto: string; html: string; push: MensajePush } {
  const ruta = e.rol === "jefe_pista" ? "/jefe" : "/admin/precios";
  const turno = NOMBRE_TURNO[e.turno];
  const precios = [...e.precios].sort(
    (a, b) => ORDEN.indexOf(a.tipo_combustible) - ORDEN.indexOf(b.tipo_combustible),
  );
  const nombre = (t: string) => NOMBRE_COMBUSTIBLE[t] ?? t;

  const asunto = `Turno ${turno} en ${e.gasolinera} empieza a las ${e.horaInicio}: revisa los precios`;
  const lineas = precios.length
    ? precios.map((p) => `${nombre(p.tipo_combustible)}: ${q(p.precio_galon)}`)
    : [`Todavía no hay precios cargados para hoy en ${e.gasolinera}.`];
  const enlace = `${e.frontendUrl}${ruta}`;

  const texto = [
    `En 30 minutos empieza el turno ${turno} en ${e.gasolinera} (${e.horaInicio}).`,
    "",
    precios.length ? "Precios vigentes:" : "",
    ...lineas,
    "",
    `Revisar precios: ${enlace}`,
  ].join("\n");

  const html = `<p>En 30 minutos empieza el turno <strong>${turno}</strong> en <strong>${escapar(e.gasolinera)}</strong> (${e.horaInicio}).</p>
${precios.length ? `<p>Precios vigentes:</p><ul>${lineas.map((l) => `<li>${escapar(l)}</li>`).join("")}</ul>` : `<p>${escapar(lineas[0])}</p>`}
<p><a href="${escapar(enlace)}">Revisar precios</a></p>`;

  const push: MensajePush = {
    title: `Turno ${turno} · ${e.horaInicio}`,
    body: `${e.gasolinera}: ${
      precios.length
        ? precios.map((p) => `${nombre(p.tipo_combustible)} ${q(p.precio_galon)}`).join(" · ")
        : "Sin precios cargados hoy"
    }`,
    url: ruta,
  };

  return { asunto, texto, html, push };
}
```

- [ ] **Paso 3: Verificar**

Run: `pnpm test -- --testPathPatterns=recordatorio.mensaje`
Expected: PASS (5 tests).

- [ ] **Paso 4: Commit**

```bash
git add src/modules/turnos/recordatorio.mensaje.ts src/modules/turnos/recordatorio.mensaje.spec.ts
git commit -m "feat(turnos): mensaje del recordatorio de precios

Correo y push con los precios vigentes del día o un aviso explícito de
que no hay precios cargados. Enlaza a /jefe o /admin/precios según el
rol y escapa el HTML del nombre de la gasolinera."
```

---

### Tarea 8: Servicio de recordatorios (cron + envío idempotente)

**Files:**
- Create: `src/modules/turnos/recordatorios.service.ts`
- Test: `src/modules/turnos/recordatorios.service.spec.ts`
- Modify: `src/modules/turnos/turnos.module.ts`, `src/app.module.ts`
- Test: `test/fase6.e2e-spec.ts`

**Interfaces:**
- Consumes: `debeRecordar` (T2), `aFila` (T4), `armarRecordatorio` (T7), `SuscripcionesPushService.enviarAUsuarios` (T6), `MailService.enviar` (Fase 2), `fechaGuatemala`, `sumarDias` (T1).
- Produces:
  - `RecordatoriosService.tick(): Promise<void>` (`@Cron`)
  - `RecordatoriosService.ejecutar(ahoraUtc: Date): Promise<{ enviados: { gasolinera_id: string; turno: string; fecha: string; correos: number; push: number }[] }>`

- [ ] **Paso 1: Unit test que falla (aislamiento de fallos y flag)**

```ts
// src/modules/turnos/recordatorios.service.spec.ts
import { ConfigService } from "@nestjs/config";
import { RecordatoriosService } from "./recordatorios.service";

const config = (vars: Record<string, string | undefined>) =>
  ({ get: (k: string) => vars[k] }) as unknown as ConfigService;

describe("RecordatoriosService", () => {
  it("con RECORDATORIOS_ACTIVOS=false el tick no ejecuta nada", async () => {
    const s = new RecordatoriosService({} as any, config({ RECORDATORIOS_ACTIVOS: "false" }), {} as any, {} as any);
    const spy = jest.spyOn(s, "ejecutar").mockResolvedValue({ enviados: [] });
    await s.tick();
    expect(spy).not.toHaveBeenCalled();
  });

  it("el tick nunca lanza aunque ejecutar falle", async () => {
    const s = new RecordatoriosService({} as any, config({}), {} as any, {} as any);
    jest.spyOn(s, "ejecutar").mockRejectedValue(new Error("BD caída"));
    await expect(s.tick()).resolves.toBeUndefined();
  });

  it("un turno que falla no impide enviar los demás", async () => {
    const s = new RecordatoriosService({} as any, config({}), {} as any, {} as any);
    jest.spyOn(s as any, "turnosCandidatos").mockResolvedValue([
      { gasolinera_id: "g1", gasolinera: "Uno", turno: "tarde", hora_inicio: "14:00" },
      { gasolinera_id: "g2", gasolinera: "Dos", turno: "tarde", hora_inicio: "14:00" },
    ]);
    const enviar = jest
      .spyOn(s as any, "procesarTurno")
      .mockRejectedValueOnce(new Error("Resend caído"))
      .mockResolvedValueOnce({ gasolinera_id: "g2", turno: "tarde", fecha: "2026-09-25", correos: 1, push: 0 });
    const r = await s.ejecutar(new Date("2026-09-25T19:45:00Z")); // 13:45 GT
    expect(enviar).toHaveBeenCalledTimes(2);
    expect(r.enviados.map((e) => e.gasolinera_id)).toEqual(["g2"]);
  });
});
```

Run: `pnpm test -- --testPathPatterns=recordatorios.service`
Expected: FAIL.

- [ ] **Paso 2: Implementar**

```ts
// src/modules/turnos/recordatorios.service.ts
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Cron, CronExpression } from "@nestjs/schedule";
import { and, eq, inArray } from "drizzle-orm";
import { DbService } from "../../db/db.service";
import {
  gasolineras,
  preciosCombustible,
  recordatoriosTurno,
  turnosGasolinera,
  usuarios,
} from "../../db/schema";
import { MailService } from "../../mail/mail.service";
import { SuscripcionesPushService } from "../push/suscripciones-push.service";
import { armarRecordatorio } from "./recordatorio.mensaje";
import type { Turno } from "./turnos.constants";
import { debeRecordar } from "./turnos.util";

interface Candidato {
  gasolinera_id: string;
  gasolinera: string;
  turno: Turno;
  hora_inicio: string;
}

interface Enviado {
  gasolinera_id: string;
  turno: string;
  fecha: string;
  correos: number;
  push: number;
}

/**
 * Aviso de precios 30 minutos antes de cada turno.
 *
 * El cron sólo despierta cada minuto: @nestjs/schedule corre en la zona del
 * proceso, así que ninguna decisión se toma con la hora local. Toda la lógica
 * vive en ejecutar(ahoraUtc), que los tests llaman con un instante fijo.
 *
 * Garantía: como mucho una vez por (gasolinera, turno, fecha). Si el proceso
 * muere entre reclamar la fila y enviar, ese aviso se pierde; se prefiere eso
 * a reintentar y mandar duplicados.
 */
@Injectable()
export class RecordatoriosService {
  private readonly logger = new Logger(RecordatoriosService.name);

  constructor(
    private db: DbService,
    private config: ConfigService,
    private mail: MailService,
    private suscripciones: SuscripcionesPushService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async tick(): Promise<void> {
    if (this.config.get<string>("RECORDATORIOS_ACTIVOS") === "false") return;
    try {
      await this.ejecutar(new Date());
    } catch (e) {
      this.logger.error(`Tick de recordatorios falló: ${(e as Error).message}`);
    }
  }

  async ejecutar(ahoraUtc: Date): Promise<{ enviados: Enviado[] }> {
    const enviados: Enviado[] = [];
    for (const c of await this.turnosCandidatos()) {
      const toca = debeRecordar(ahoraUtc, c.hora_inicio);
      if (!toca) continue;
      try {
        const r = await this.procesarTurno(c, toca.fecha);
        if (r) enviados.push(r);
      } catch (e) {
        this.logger.error(`Recordatorio ${c.gasolinera_id}/${c.turno} falló: ${(e as Error).message}`);
      }
    }
    return { enviados };
  }

  private async turnosCandidatos(): Promise<Candidato[]> {
    const rows = await this.db.db
      .select({
        gasolinera_id: turnosGasolinera.gasolinera_id,
        gasolinera: gasolineras.nombre,
        turno: turnosGasolinera.turno,
        hora_inicio: turnosGasolinera.hora_inicio,
      })
      .from(turnosGasolinera)
      .innerJoin(gasolineras, eq(turnosGasolinera.gasolinera_id, gasolineras.id))
      .where(
        and(
          eq(turnosGasolinera.recordatorio_activo, true),
          eq(gasolineras.activo, true),
          eq(gasolineras.bloqueado, false),
        ),
      );
    return rows.map((r) => ({ ...r, turno: r.turno as Turno, hora_inicio: r.hora_inicio.slice(0, 5) }));
  }

  private async procesarTurno(c: Candidato, fecha: string): Promise<Enviado | null> {
    // El candado: sólo quien inserta la fila envía.
    const [reclamo] = await this.db.db
      .insert(recordatoriosTurno)
      .values({ gasolinera_id: c.gasolinera_id, turno: c.turno, fecha })
      .onConflictDoNothing()
      .returning({ id: recordatoriosTurno.id });
    if (!reclamo) return null;

    // Precios del día en que arranca el turno (fecha GT), no del día UTC.
    const precios = await this.db.db
      .select({ tipo_combustible: preciosCombustible.tipo_combustible, precio_galon: preciosCombustible.precio_galon })
      .from(preciosCombustible)
      .where(and(eq(preciosCombustible.gasolinera_id, c.gasolinera_id), eq(preciosCombustible.fecha, fecha)));

    const destinatarios = await this.db.db
      .select({ id: usuarios.id, email: usuarios.email, rol: usuarios.rol })
      .from(usuarios)
      .where(and(inArray(usuarios.rol, ["admin", "jefe_pista"]), eq(usuarios.activo, true)));

    const frontendUrl = this.config.get<string>("FRONTEND_URL") ?? "";
    const mensajePara = (rol: string) =>
      armarRecordatorio({
        gasolinera: c.gasolinera,
        turno: c.turno,
        horaInicio: c.hora_inicio,
        precios,
        frontendUrl,
        rol: rol === "jefe_pista" ? "jefe_pista" : "admin",
      });

    // Canales independientes: un fallo de Resend no frena el push, y al revés.
    let correos = 0;
    for (const d of destinatarios) {
      if (!d.email) continue;
      const m = mensajePara(d.rol);
      try {
        await this.mail.enviar({ para: d.email, asunto: m.asunto, html: m.html, texto: m.texto });
        correos++;
      } catch (e) {
        this.logger.error(`Correo de recordatorio a ${d.id} falló: ${(e as Error).message}`);
      }
    }

    let push = 0;
    try {
      const rolPorId = new Map(destinatarios.map((d) => [d.id, d.rol]));
      push = await this.suscripciones.enviarAUsuarios(
        destinatarios.map((d) => d.id),
        (id) => mensajePara(rolPorId.get(id) ?? "admin").push,
      );
    } catch (e) {
      this.logger.error(`Push de recordatorio falló: ${(e as Error).message}`);
    }

    await this.db.db
      .update(recordatoriosTurno)
      .set({ correos_enviados: correos, push_enviados: push })
      .where(eq(recordatoriosTurno.id, reclamo.id));

    return { gasolinera_id: c.gasolinera_id, turno: c.turno, fecha, correos, push };
  }
}
```

En `turnos.module.ts`: `imports: [PushSuscripcionesModule]` y `providers: [TurnosService, RecordatoriosService]`. En `app.module.ts`: `import { ScheduleModule } from "@nestjs/schedule";` y agregar `ScheduleModule.forRoot()` a `imports` justo después de `ConfigModule.forRoot(...)`.

Run: `pnpm test -- --testPathPatterns=recordatorios.service`
Expected: PASS (3 tests).

- [ ] **Paso 3: e2e de envío, idempotencia y destinatarios.** En `test/fase6.e2e-spec.ts`, importar `RecordatoriosService` y `recordatoriosTurno`, y agregar:

```ts
  describe("Recordatorios", () => {
    let recordatorios: RecordatoriosService;
    // Gasolinera propia para no depender del horario que dejaron los tests de turnos.
    let gasRId: string;
    const instante = (fechaGt: string, hhmmGt: string) =>
      new Date(new Date(`${fechaGt}T${hhmmGt}:00Z`).getTime() + 6 * 3600 * 1000);

    beforeAll(async () => {
      recordatorios = app.get(RecordatoriosService);
      const res = await http()
        .post("/api/v1/gasolineras")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ nombre: `[F6-${RUN_ID}] Estación R`, direccion: "Km 1", ciudad: "Morales" });
      gasRId = res.body.id;
      // Sólo esta gasolinera tiene recordatorio: aislamos de otras de la BD.
      await db.db.update(turnosGasolinera).set({ recordatorio_activo: false });
      await db.db
        .update(turnosGasolinera)
        .set({ recordatorio_activo: true })
        .where(eq(turnosGasolinera.gasolinera_id, gasRId));
    });

    afterAll(async () => {
      // Restaurar el flag del resto de gasolineras de la BD de desarrollo.
      await db.db.update(turnosGasolinera).set({ recordatorio_activo: true });
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

    it("turno que empieza a las 00:15: el aviso de las 23:50 GT (05:50 UTC) lleva la fecha GT del día siguiente", async () => {
      await db.db
        .update(turnosGasolinera)
        .set({ hora_inicio: "00:15", hora_fin: "06:00" })
        .where(and(eq(turnosGasolinera.gasolinera_id, gasRId), eq(turnosGasolinera.turno, "manana")));
      await db.db
        .update(turnosGasolinera)
        .set({ hora_inicio: "06:00", hora_fin: "00:15" })
        .where(and(eq(turnosGasolinera.gasolinera_id, gasRId), eq(turnosGasolinera.turno, "tarde")));
      const r = await recordatorios.ejecutar(instante("2030-01-14", "23:50"));
      expect(r.enviados).toEqual([expect.objectContaining({ turno: "manana", fecha: "2030-01-15" })]);
      // Restaurar horario por defecto
      await db.db.update(turnosGasolinera).set({ hora_inicio: "06:00", hora_fin: "14:00" })
        .where(and(eq(turnosGasolinera.gasolinera_id, gasRId), eq(turnosGasolinera.turno, "manana")));
      await db.db.update(turnosGasolinera).set({ hora_inicio: "14:00", hora_fin: "22:00" })
        .where(and(eq(turnosGasolinera.gasolinera_id, gasRId), eq(turnosGasolinera.turno, "tarde")));
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
      const r = await recordatorios.ejecutar(instante("2030-01-17", "13:45"));
      expect(r.enviados).toHaveLength(0);
      await db.db.update(gasolineras).set({ bloqueado: false }).where(eq(gasolineras.id, gasRId));
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
```

Las fechas en 2030 evitan chocar con filas de `recordatorios_turno` de corridas anteriores.

Nota: el primer `beforeAll` de este bloque desactiva `recordatorio_activo` en **todas** las gasolineras de la BD de desarrollo y el `afterAll` lo restaura a `true` para todas. Es aceptable en una BD de pruebas. Si la BD de desarrollo tiene turnos con el recordatorio apagado a propósito, se pierde ese estado: correr los e2e contra una BD desechable (`docker compose down -v`).

Run: `pnpm test:e2e -- --testPathPatterns=fase6`
Expected: PASS.

- [ ] **Paso 4: Commit**

```bash
git add src/modules/turnos src/app.module.ts test/fase6.e2e-spec.ts
git commit -m "feat(turnos): recordatorio de precios 30 minutos antes de cada turno

Cron cada minuto con @nestjs/schedule que sólo despierta: la decisión
usa la hora de Guatemala en ejecutar(ahoraUtc). Cada aviso se reclama con
INSERT ... ON CONFLICT DO NOTHING sobre (gasolinera, turno, fecha), así
que sale una sola vez aunque haya reinicios o varias instancias. Correo y
push son canales independientes y un turno que falla no frena los demás."
```

---

### Tarea 9: El operario se lee y se valida (H1 + H2)

**Files:**
- Modify: `src/modules/despachos/despachos.service.ts` (`findOne`, `findAll`, `create`)
- Modify: `src/modules/despachos/despachos-excel.service.ts`
- Test: `test/gasfuel.e2e-spec.ts` (sección 8)

**Interfaces:**
- Produces: `findOne` devuelve además `operario: { id: string; nombre: string } | null`, y cada fila de `findAll` trae `operario: { id, nombre } | null`. Error 400 `"El operario no pertenece a esta gasolinera o está inactivo."`.

- [ ] **Paso 1: Tests que fallan.** En `test/gasfuel.e2e-spec.ts`, dentro de `describe("8. Despachos de Combustible")`, después del test "el saldo del cliente se descontó…":

```ts
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
```

Antes de escribirlos, verificar con `grep -n "@Delete\|@Patch" src/modules/operarios/operarios.controller.ts` que existe la baja de operario y cuál es su ruta y status. Si es `PATCH { activo: false }`, ajustar el test.

Run: `pnpm test:e2e:gasfuel`
Expected: FAIL en los tres tests nuevos.

- [ ] **Paso 2: Implementar H2 en `create`.** Importar `operarios` desde `../../db/schema`. Después del bloque "2. Bloqueo de gasolinera + serie de vale activa":

```ts
    // ── 2b. Operario de esta gasolinera y activo ─────────────────────────
    // La FK sólo garantiza que existe. Sin esto un supervisor podía cargar el
    // vale a un operario de la otra estación o a uno dado de baja.
    const [operario] = await this.db.db
      .select({ id: operarios.id })
      .from(operarios)
      .where(
        and(
          eq(operarios.id, dto.operario_id),
          eq(operarios.gasolinera_id, user.gasolinera_id),
          eq(operarios.activo, true),
        ),
      )
      .limit(1);
    if (!operario) {
      throw new BadRequestException(
        "El operario no pertenece a esta gasolinera o está inactivo.",
      );
    }
```

- [ ] **Paso 3: Implementar H1 en `findOne`.** En el `select`, agregar `operario: { id: operarios.id, nombre: operarios.nombre },` y después de `.leftJoin(pilotos, …)`:

```ts
      // leftJoin: los vales anteriores a la Fase 1 no tienen operario.
      .leftJoin(operarios, eq(despachos.operario_id, operarios.id))
```

Drizzle devuelve `operario: null` cuando el leftJoin no encuentra fila.

- [ ] **Paso 4: H1 en `findAll`.** Reemplazar `.select().from(despachos)` por:

```ts
      .select({
        ...getTableColumns(despachos),
        operario: { id: operarios.id, nombre: operarios.nombre },
      })
      .from(despachos)
      .leftJoin(operarios, eq(despachos.operario_id, operarios.id))
```

Importar `getTableColumns` de `drizzle-orm`. (La forma de la respuesta con `total` cambia en la Tarea 10.)

- [ ] **Paso 5: H1 en el Excel.** En `despachos-excel.service.ts`, agregar `operario: operarios.nombre,` al `select` (después de `codigo_piloto`), `.leftJoin(operarios, eq(despachos.operario_id, operarios.id))` junto a los demás leftJoin, la columna `{ header: "Operario", key: "operario", width: 22 },` después de la de `"Piloto"`, y `operario: r.operario ?? "",` en `ws.addRow({...})`.

- [ ] **Paso 6: Test del listado.** Agregar en la sección 9:

```ts
    it("cada despacho del listado trae su operario", async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/despachos?cliente_id=${cliente1Id}`)
        .set("Authorization", `Bearer ${adminToken}`);
      expect(res.body.every((d: any) => d.operario?.id === operarioId)).toBe(true);
    });
```

(En la Tarea 10 pasa a `res.body.data.every`.)

- [ ] **Paso 7: Verificar**

Run: `pnpm test:e2e`
Expected: PASS en todas las suites.

- [ ] **Paso 8: Commit**

```bash
git add src/modules/despachos test/gasfuel.e2e-spec.ts
git commit -m "fix(despachos): el operario se valida al despachar y aparece en detalle, listado y Excel

El operario se guardaba pero nunca se leía, así que no había forma de
saber quién despachó. Además sólo la FK lo protegía: ahora un operario
de otra estación o dado de baja se rechaza con 400."
```

---

### Tarea 10: Paginación real en el listado de despachos (H7)

**Files:**
- Modify: `src/modules/despachos/despachos.service.ts` (`findAll`)
- Test: `test/gasfuel.e2e-spec.ts` (líneas ~755-830, 1133, 1729, 1752, 1842 y la nueva de la Tarea 9)

**Interfaces:**
- Produces: `GET /despachos` → `{ data: Despacho[]; total: number; page: number; limit: number }`.

- [ ] **Paso 1: Revisar otros consumidores internos**

Run: `grep -rn "despachosService.findAll\|\.findAll(" src/modules | grep -i despach`
Expected: sólo el controller. Si aparece otro, adaptarlo en este mismo paso.

- [ ] **Paso 2: Test que falla.** Reemplazar el primer test de la sección 9:

```ts
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
```

Run: `pnpm test:e2e:gasfuel`
Expected: FAIL (`res.body.data` es undefined).

- [ ] **Paso 3: Implementar**

```ts
    const where = conditions.length ? and(...conditions) : undefined;
    const [data, [{ total }]] = await Promise.all([
      this.db.db
        .select({
          ...getTableColumns(despachos),
          operario: { id: operarios.id, nombre: operarios.nombre },
        })
        .from(despachos)
        .leftJoin(operarios, eq(despachos.operario_id, operarios.id))
        .where(where)
        .orderBy(sql`${despachos.despachado_at} DESC`)
        .limit(limit)
        .offset(offset),
      this.db.db
        .select({ total: sql<number>`count(*)::int` })
        .from(despachos)
        .where(where),
    ]);
    return { data, total, page, limit };
```

- [ ] **Paso 4: Actualizar los tests restantes.** En cada test que llama a `GET /api/v1/despachos…` (líneas ~768, 781, 793, 803, 812, 822, 1133, 1729, 1752, 1842 y el test de operario de la Tarea 9), cambiar `res.body` por `res.body.data` en las aserciones de longitud, índice, `every`, `map`, `find` y `some`. Localizarlos con:

Run: `grep -n "api/v1/despachos?" test/gasfuel.e2e-spec.ts` y revisar el `expect` de cada uno a mano. No usar un reemplazo global: las líneas 886-957 son de otros endpoints (reportes) que siguen devolviendo arreglos.

- [ ] **Paso 5: Verificar**

Run: `pnpm test:e2e`
Expected: PASS en todas las suites.

- [ ] **Paso 6: Commit**

```bash
git add src/modules/despachos/despachos.service.ts test/gasfuel.e2e-spec.ts
git commit -m "feat(despachos)!: el listado devuelve data, total, page y limit

El frontend estimaba la paginación porque no había total. Cambio de
contrato: GET /despachos pasa de arreglo a objeto; el frontend se
actualiza en el mismo ciclo."
```

---

### Tarea 11: Contrato, documentación y verificación final

**Files:**
- Modify: `docs/contrato-frontend.md`, `CLAUDE.md` (del backend), `README.md` (sección de env, si lista variables)
- Modify: `docs/superpowers/specs/2026-09-25-fase-6-turnos-recordatorios-design.md` (sólo si la implementación se desvió)

- [ ] **Paso 1: Contrato.** Agregar a `docs/contrato-frontend.md` una sección `## 1f. Fase 6: turnos, recordatorios y push`, con estos endpoints y ejemplos de request/response exactamente como los implementan las Tareas 4-6:
  - `GET/PATCH /gasolineras/:id/turnos`, `GET /turnos/actual`.
  - `GET /push/vapid-public-key`, `POST/DELETE /push/suscripciones` (body `{ endpoint, keys: { p256dh, auth } }` **sin** `expirationTime`).
  - Nueva forma de `GET /despachos`: `{ data, total, page, limit }`, con `operario` en cada fila y en el detalle.
  - Permisos de lectura del jefe de pista y `GET /precios-combustible/hoy?gasolinera_id=`.
  - La nota de que "hoy" es siempre la fecha de Guatemala (H9).

- [ ] **Paso 2: CLAUDE.md del backend.** Actualizar el número de tests e2e y documentar el módulo `turnos`, `src/push` y `src/common/hora-guatemala.ts` ("todo 'hoy' pasa por aquí"). Documentar también las env opcionales `VAPID_*` y `RECORDATORIOS_ACTIVOS`, y que los e2e deben sobreescribir `PushService` con `InMemoryPushService`.

- [ ] **Paso 3: Spec.** Ya incluye H9 y los ajustes de reloj y de borrado de suscripciones. Si la implementación se desvió en algo más, reflejarlo aquí.

- [ ] **Paso 4: Verificación completa**

```bash
pnpm lint
pnpm build
pnpm test
pnpm test:e2e
```

Expected: lint sin errores, build limpio, todos los unit tests en verde (1 original + 6 hora-guatemala + 16 turnos.util + 5 web-push + 5 mensaje + 3 recordatorios = 36) y los e2e en verde (156 previos + los nuevos de `fase6` + los de H1/H2/H7 en `gasfuel`). Anotar los números exactos para el CLAUDE.md.

- [ ] **Paso 5: Prueba manual del cron real** (con el backend levantado y `RECORDATORIOS_ACTIVOS` sin definir):

```bash
# Poner el turno de la tarde de una gasolinera 20 minutos después de la hora GT actual
docker compose exec postgres psql -U gasfuel_user -d gasfuel_db -c \
"UPDATE turnos_gasolinera SET hora_inicio = to_char(now() - interval '6 hours' + interval '20 minutes', 'HH24:MI')::time, hora_fin = to_char(now() - interval '6 hours' + interval '3 hours', 'HH24:MI')::time WHERE turno='tarde' AND gasolinera_id=(SELECT id FROM gasolineras WHERE activo LIMIT 1);"
```

En menos de un minuto debe aparecer una fila nueva en `recordatorios_turno`. Con VAPID configurado y un navegador suscrito (plan del frontend), llega la notificación. Sin `RESEND_API_KEY` válido el log muestra el error del correo y el push sale igual. Después, restaurar el horario del turno desde `/admin/turnos` o con otro `UPDATE`.

- [ ] **Paso 6: Commit**

```bash
git add docs CLAUDE.md README.md
git commit -m "docs: contrato y guía del backend para la Fase 6

Documenta turnos, push, la nueva forma paginada de GET /despachos, el
operario en las respuestas y que todo 'hoy' es la fecha de Guatemala."
```
