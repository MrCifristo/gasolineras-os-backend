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
  Signatures upload to Cloudflare R2 (S3-compatible; MinIO in dev), stored as
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
- All time math hardcodes **UTC-6** for Guatemala (`getGuatemalaTime()`, plus
  `- INTERVAL '6 hours'` in raw SQL). No DST, no `AT TIME ZONE`.
