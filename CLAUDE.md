# CLAUDE.md

Guidance for Claude Code / developers working in the GasFuel OS backend
(package `gasfuel-backend`). NestJS 11 + Drizzle ORM over `node-postgres`.

## Project

Fuel dispatch REST API for gas stations: fuel vouchers (`despachos`), customer
prepaid balance ledgers, pilots (`pilotos`), vehicles, and Excel/PDF reports.
**Domain language is Spanish throughout** — schema columns, DTOs, routes, and
user-facing error strings. Keep it that way; do not anglicize identifiers.

Setup: `pnpm setup` (env + docker postgres + migrations), then
`pnpm bootstrap:admin` (a **separate** step, not part of setup). The real
integration suite is `pnpm test:e2e:gasfuel` (needs live Postgres + `.env`).
**`docs/contrato-frontend.md` is the binding frontend/backend contract** — read
it before changing anything at the API seam.

## Conventions that bite

- **All queries go through `DbService.db`**, assigned in `onModuleInit`
  (undefined at construction — never touch it from a constructor). `DbModule`
  is `@Global()`, so feature modules do **not** import it.
- **Guards are opt-in per route, never global.** `@Auth(...roles)` = `AuthGuard`
  + `RolesGuard`; `RolesGuard` with no `@Roles` metadata returns `true`, so bare
  `@Auth()` means "any authenticated role". Role scoping (`operario` →
  `gasolinera_id`, `cliente` → `cliente_id`) is enforced **ad-hoc inside
  services**, not by a guard — so `findOne(id)` must scope by hand or it IDORs.
- **Auth is internal (not Supabase).** Argon2id password hashing (`@node-rs/argon2`)
  + HS256 access JWT the app signs itself (15 min) + opaque rotating refresh
  tokens with reuse-detection (a replayed refresh revokes the whole session
  family). Login returns `{access_token, refresh_token, usuario}` in the body.
  Signatures upload to Cloudflare R2 (S3-compatible; RustFS in dev — MinIO stopped publishing images), stored as
  `firma_key`, read back via the auth-scoped proxy `GET /despachos/:id/firma`.
- **Two swappable infrastructure ports**, both `@Global()` and both keyed by an
  abstract class so `overrideProvider` can replace them in e2e: `StorageService`
  (R2 / in-memory) and `MailService` (Resend / in-memory). Both **fail at boot**
  when their env is missing — `R2_*`, and `RESEND_API_KEY` + `MAIL_FROM`. A
  password reset that silently sends no mail is worse than a backend that
  refuses to start.
- **Password plaintext leaves the server exactly once.** `POST /usuarios` and
  `POST /usuarios/:id/reset-password` (`modo: "generar"`) return
  `password_temporal` in the response body and never persist it.
  `forbidNonWhitelisted` only constrains requests, so returning an extra key is
  fine. Reset tokens are stored as SHA-256 only, expire in 60 min, are
  single-use, and a new request invalidates the previous one.
- Global prefix `api/v1`; `ValidationPipe` with `whitelist` +
  `forbidNonWhitelisted`, so unknown body keys **400** rather than being stripped
  (e2e bootstraps must replicate this pipe config).
- Soft delete (`activo`) and blocking (`bloqueado`) are separate concepts;
  `DELETE` routes update, never remove. **`credito_bloqueado` is a third,
  distinct thing**: it stops dispatches but leaves the account queryable and
  abonable. Don't collapse it into `bloqueado`.
- **`movimientos_saldo.gasolinera_id` is nullable.** The opening-balance movement
  (`saldo_inicial` on `POST /clientes`) happens at no station. Any aggregate
  grouped by station must handle the NULL. The ledger stores `monto` positive
  and encodes direction in `tipo` (`credito` / `debito`).
- Raw `sql` templates carry the aggregate/date logic (`FILTER (WHERE …)`,
  `date_trunc`) rather than doing it in JS.

## Multi-line vouchers (`despacho_detalles`)

A voucher splits across the vehicle, canecas and toneles in any combination —
including **no vehicle at all**. Each line carries its own fuel type, price and
amount; the header keeps `monto_total`/`galones` as the **sum**.

- `despachos.vehiculo_id`, `piloto_id` and `precio_id` are **nullable**. Every
  read path must use `leftJoin` — an `innerJoin` silently drops container-only
  vouchers, which is how you lose a dispatch from an accounting export.
- **Vehicle limits aggregate over `despacho_detalles` filtered to
  `renglon = 'vehiculo'`**, never `despachos.monto_total`. Summing the header
  would charge the vehicle for fuel that went into drums. Client limits and the
  balance debit *do* use the total. A mixed voucher is **one** transaction.
- Migration `0004` backfilled one `vehiculo` line per pre-existing dispatch. That
  backfill is load-bearing: without it the aggregate reads zero for all history
  and a vehicle past its monthly cap would dispatch again unblocked.
- One voucher is still **one header row**, so the advisory-lock numbering is
  unchanged.
- `POST /despachos` still accepts the old single-line shape
  (`tipo_combustible` + `monto` at the root) and normalizes it to one `vehiculo`
  line. Sending both shapes is a 400.

## Supplies inventory (`inventario` / `ventas-insumos`)

- **Stock never goes negative.** Unlike client balances (which go negative on
  purpose), a stock movement that would cross zero is a 400. Sales check stock
  with the product rows locked `FOR UPDATE`, so two concurrent sales of the last
  item can't both succeed.
- **`stock_actual` is not editable via `PATCH`** — it's omitted from the update
  DTO, so `forbidNonWhitelisted` rejects it. Stock only moves through
  `POST /inventario/productos/:id/stock`, which writes to the
  `inventario_movimientos` kardex. Every change to the number has a row
  explaining it, including the opening balance.
- **`forma_pago` decides whether the ledger is touched**: `efectivo` only moves
  stock; `cargo_cliente` also writes a `movimientos_saldo` debit and decrements
  the balance, so it shows up in the account statement next to fuel. `cliente_id`
  is required for the first and forbidden for the second.
- Sales carry **their own vale series** with their own advisory-lock key
  (`gasolinera_id || ':INSUMOS:' || serie`), so they never contend with fuel
  numbering. `precio_unitario` is frozen per line.
- Pumps 1 and 3 are a **DTO-level rule** (`@IsIn([1, 3])`), not a schema entity —
  there is no pump table.

## Dispatch creation — read this first (`despachos.service.ts`)

The heart of the system. Validation cascades through system → gasolinera →
cliente → vehículo block levels, then the per-vehicle limit matrix
(monto/volumen/transacciones × transacción/día/semana/mes), allowed products,
allowed days, and hour window. Only then a transaction opens with
`pg_advisory_xact_lock(hashtext(gasolinera_id || ':' || serie_vale))` to
serialize vale numbering, inserts the despacho, writes the `movimientos_saldo`
debit, and decrements `saldos_cliente`. Things that surprise people:

- `monto_total` is computed **before** the transaction, so all pre-lock checks
  are TOCTOU-racy by design.
- There is **no insufficient-funds check** — balances go negative on purpose,
  and an e2e test asserts it.
- Dispatch create takes `monto` (quetzales); the server derives `galones` from
  its own price. `serie_vale` comes from `gasolineras.serie_vale_actual`, not
  the client.
- All time math hardcodes **UTC-6** for Guatemala (`ahoraGuatemala()` /
  `diaYMinutoGuatemala()`, plus
  `- INTERVAL '6 hours'` in raw SQL). No DST, no `AT TIME ZONE`.

## Shifts, reminders and push (Fase 6)

- **`src/common/hora-guatemala.ts` — every "today" goes through here.**
  `ahoraGuatemala()`, `fechaGuatemala()`, `sumarDias()`, `aMinutos()` and
  `fechaGtSql(col)` (SQL: `(col - INTERVAL '6 hours')::date`). Never use
  `new Date().toISOString()` or `timestamp::date` for a business date: from
  18:00 to 23:59 Guatemala time the UTC date is already tomorrow, and price
  lookups and date filters silently go wrong.
- **`src/modules/turnos/`** — `turnos_gasolinera` holds two rows per station
  (`manana`/`tarde`, `hora_inicio`/`hora_fin`, `recordatorio_activo`), created
  with the station in the same transaction. Pure helpers live in `turnos.util.ts`
  (`seSolapan`, `turnoEnMinuto`, `debeRecordar(ahoraUtc, horaInicio)` — it takes
  the **UTC instant** and converts itself). Routes: `GET/PATCH
  /gasolineras/:id/turnos`, `GET /turnos/actual` (the supervisor is pinned to
  their own station).
- **`RecordatoriosService`** — `@Cron(EVERY_MINUTE)` only wakes up; all logic is
  in `ejecutar(ahoraUtc)` so tests call it with a fixed instant. It claims
  `recordatorios_turno` with `ON CONFLICT (gasolinera_id, turno, fecha) DO NOTHING`
  and only the inserter sends, so at most one notice per station/shift/GT date.
  Sends email (`MailService`) and push to active `admin` + `jefe_pista`.
  **`RECORDATORIOS_ACTIVOS=false` turns the cron off** (all three e2e suites
  set it so the real cron never runs during tests).
- **`src/push/`** — `PushService` is a third swappable port (abstract class,
  `@Global`): `WebPushService` (web-push + VAPID) in production,
  `InMemoryPushService` in e2e. **E2E bootstraps must
  `.overrideProvider(PushService).useClass(InMemoryPushService)`**, like
  `StorageService` and `MailService`. `src/modules/push/` holds the
  subscription endpoints (`/push/vapid-public-key`, `/push/suscripciones`).
  Expired endpoints (404/410 from the push service) are deleted.
- **Optional env:** `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`
  (generate with `pnpm vapid:generate`) and `RECORDATORIOS_ACTIVOS`. Unlike
  `R2_*` and `RESEND_API_KEY`, they do **not** fail the boot: without VAPID the
  push is disabled (`vapid-public-key` returns `{key: null}`) and email still goes.
- **Node 24 LTS (mínimo 24; `.nvmrc`; `engines` en `package.json`).** `@nestjs/schedule@12` is ESM-only; the compiled
  app loads it through Node's `require(esm)`, and Jest transforms it with
  ts-jest (`transformIgnorePatterns` in `package.json` and `test/jest-e2e.json`).
  Verified on Node 24.
- `GET /despachos` returns `{ data, total, page, limit }` and every despacho
  (list and detail) carries `operario: { id, nombre } | null`. `POST /despachos`
  rejects an `operario_id` from another station or inactive (400).

## Client role: catalogues, restrictions and scoping

- **El cliente lee los catálogos:** `GET /gasolineras` (lista de activas),
  `GET /gasolineras/:id` (devuelve también inactivas), `GET /precios-combustible`
  y `/hoy?gasolinera_id=` (obligatorio, 400 si falta). Sólo lectura; no escribe nada
  de ellos. Así sus reportes recuperan el desglose por combustible y estación.
- **`PATCH /vehiculos/:id/restricciones`** (`admin` o `cliente` dueño). El DTO
  admite sólo campos de restricción (`bloqueado`, 11 `limite_*`,
  `productos_permitidos`, `dias_permitidos`, `hora_inicio`, `hora_fin`); cualquier
  otro campo es 400, `bloqueado: null` es 400. **El cliente puede bloquear
  (`true`) pero no desbloquear:** `bloqueado: false` es siempre 403 "Sólo la
  estación puede desbloquear un vehículo." y no aplica ningún otro campo. Vehículo
  ajeno o inexistente: 404 indistinguible.
- **El cliente gestiona su flota y sus pilotos:** `POST`, `PATCH /:id` y
  `DELETE /:id` de `/vehiculos` y `/pilotos` admiten `admin` y `cliente`.
  El `cliente_id` sale del token y pisa el del body (opcional en el DTO; el admin
  sin él recibe 400); el filtro por empresa va en el propio UPDATE (ajeno = 404);
  un `cliente_id` ajeno en el PATCH es 403 ("No puede asignar el vehículo/piloto a
  otra empresa", `cliente_id: null` es 403 al cliente y 400 al admin); `bloqueado: false` por el PATCH general sigue siendo 403. La placa se normaliza (trim + mayúsculas), el cliente no puede cambiarla (403, evade bloqueos) y una repetida da 409. Asignar
  pilotos a vehículos (`/vehiculos/:id/pilotos/:pilotoId`) es sólo `admin`.
  Reglas en `vehiculos.reglas.ts` y `pilotos.reglas.ts`.
- `GET /vehiculos` y `/:id` incluyen `ultimo_kilometraje` (`MAX(despachos.kilometraje)`,
  string numérico o `null`) vía subconsulta correlacionada, sin N+1.
- **Alcance del cliente, fail-closed:** `GET /vehiculos`, `/pilotos`, `/clientes`
  (y sus `:id`), `/despachos/vehiculo/:id/consumo-hoy` y los reportes (`resumen`,
  `consumo-por-vehiculo`, `consumo-por-piloto`, `tendencia-mensual`,
  `rendimiento-vehiculo/:id`) devuelven sólo lo del propio cliente e **ignoran un
  `cliente_id` del query**. Ajeno = 404; cliente sin `cliente_id` = vacío/404/403.
  Antes `GET /vehiculos` filtraba por el query, y un cliente podía leer a otro.
  `POST /reportes/pdf` también: un cliente sin empresa recibe 403 (antes omitía
  el filtro y el PDF traía a **todos** los clientes). La tabla completa de rutas
  que admiten al cliente está en el contrato, §1f "Alcance del cliente".
- **El cliente lee su cuenta:** `GET /saldos/cliente/:id`, `/movimientos`,
  `/estado-cuenta` y `/estado-cuenta/pdf` admiten `admin` y `cliente`. Para el
  cliente, `exigirMismaEmpresa` (`saldos.reglas.ts`) exige que `:id` sea su
  `cliente_id`; otro id o un cliente sin empresa = 404 con el mismo mensaje que
  da el servicio ("Cliente sin saldo registrado" / "Cliente no encontrado").
  `POST /saldos/abonos` y `/cuadres` siguen sólo admin.
- **Un usuario `cliente` siempre tiene `cliente_id`.** `UsuariosService.create`
  y `update` responden 400 si el resultado sería un cliente sin empresa. El
  fail-closed de los servicios se mantiene para filas viejas o editadas en BD;
  el e2e siembra ese usuario directo por BD por esa razón.
- `GET /gasolineras` sale ordenado por `nombre`.

## Testing

- Unit (`pnpm test`): 419 tests in 30 suites, no Postgres, about a second.
- **Business rules live in `<modulo>.reglas.ts`** — pure functions that receive
  plain rows (numerics as strings) and `ahora: Date`, never read the clock, the
  DB or `DbService`, and throw the same Nest exceptions with the exact Spanish
  messages the service used to. Queries stay in the service. A rule is a move,
  not a redesign: same message, same validation order.
- **`pnpm test:cov` enforces 100% (lines, branches, functions, statements) on
  every `./src/**/*.reglas.ts`** (`coverageThreshold` in `package.json`). A new
  rule without a test fails the run. No threshold for the rest of the code.
- **Assert error class *and* exact message** with `esperarError` /
  `esperarRechazo` from `test/unit/esperar-error.ts`. `toThrow(new X("m"))` only
  compares the message and `toThrow("m")` accepts substrings.
- Puppeteer is replaced in unit tests by `test/__mocks__/puppeteer.js`
  (`moduleNameMapper` in `package.json`), so PDF code runs without Chromium.
- The suspected bugs H1–H7 found during the extraction were all fixed on
  2026-10-07 (analysis kept in
  `docs/superpowers/specs/2026-10-07-pruebas-unitarias-backend-design.md`,
  `## Hallazgos`). No test is named `HALLAZGO` any more; if a new suspected bug
  is pinned that way, `grep -rn HALLAZGO src` lists it.
- E2E (`pnpm test:e2e`): 262 tests in 3 suites — `gasfuel` 166, `auth-rotacion` 8,
  `fase6` 88. Needs live Postgres and a migrated DB; run with
  `DATABASE_URL` on the command line if port 5432 is taken by another project.
- Jest 30 filter: `pnpm test --testPathPatterns=<pattern>` (without `--`).
