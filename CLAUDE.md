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
