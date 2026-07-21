#!/usr/bin/env bash
set -e

BOLD='\033[1m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

step() { echo -e "\n${BOLD}${YELLOW}▶ $1${NC}"; }
ok()   { echo -e "${GREEN}✓ $1${NC}"; }
fail() { echo -e "${RED}✗ $1${NC}"; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

echo -e "\n${BOLD}╔══════════════════════════════════════╗${NC}"
echo -e "${BOLD}║       GasFuel Backend – First Start  ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════╝${NC}"

# ── 1. Verificar dependencias ──────────────────────────────────────────────
step "Verificando dependencias del sistema"

command -v docker  >/dev/null 2>&1 || fail "Docker no está instalado"
command -v pnpm    >/dev/null 2>&1 || fail "pnpm no está instalado"
command -v openssl >/dev/null 2>&1 || fail "openssl no está instalado"
ok "docker, pnpm y openssl encontrados"

# ── 2. Archivo .env ────────────────────────────────────────────────────────
step "Configurando variables de entorno"

if [ ! -f ".env" ]; then
  cp .env.example .env
  ok "Se creó .env desde .env.example"
else
  ok ".env ya existe"
fi

# Generar el secreto de firma si está vacío. Es la única variable sin la que el
# backend no arranca, y un valor débil hace forjable cualquier token, así que
# se genera solo en vez de pedírselo a alguien.
if ! grep -qE '^JWT_ACCESS_SECRET=.+' .env; then
  SECRET="$(openssl rand -base64 48)"
  # Reemplazo compatible con el sed de BSD (macOS) y el de GNU.
  sed -i.bak "s|^JWT_ACCESS_SECRET=.*|JWT_ACCESS_SECRET=${SECRET}|" .env && rm -f .env.bak
  ok "JWT_ACCESS_SECRET generado"
else
  ok "JWT_ACCESS_SECRET ya configurado"
fi

# ── 3. Instalar dependencias de Node ───────────────────────────────────────
step "Instalando dependencias Node"

if [ ! -d "node_modules" ]; then
  pnpm install
  ok "Dependencias instaladas"
else
  ok "node_modules ya existe, omitiendo"
fi

# ── 4. Levantar PostgreSQL ─────────────────────────────────────────────────
step "Levantando PostgreSQL con Docker"

docker compose up -d postgres
ok "Contenedor iniciado"

echo "  Esperando a que PostgreSQL acepte conexiones..."
RETRIES=30
until docker compose exec -T postgres pg_isready -U gasfuel_user -d gasfuel_db >/dev/null 2>&1; do
  RETRIES=$((RETRIES - 1))
  if [ "$RETRIES" -eq 0 ]; then
    fail "PostgreSQL no respondió después de 30 intentos"
  fi
  sleep 1
  echo -n "."
done
echo ""
ok "PostgreSQL listo"

# ── 5. Aplicar migraciones ─────────────────────────────────────────────────
# No se corre db:generate: las migraciones son artefactos versionados en el
# repo. Generarlas acá produciría diffs espurios contra el baseline.
step "Aplicando migraciones a la base de datos"

pnpm run db:migrate
ok "Migraciones aplicadas"

# ── 6. Crear el primer admin ───────────────────────────────────────────────
# Antes esto era un paso manual aparte, y esa brecha es la razón de que una
# contraseña real terminara hardcodeada como fallback en la suite e2e.
step "Creando el primer administrador"

if [ -t 0 ] || { [ -n "$ADMIN_EMAIL" ] && [ -n "$ADMIN_PASSWORD" ]; }; then
  pnpm run bootstrap:admin
  ok "Admin listo"
else
  echo -e "${YELLOW}  Sin terminal interactiva y sin ADMIN_EMAIL/ADMIN_PASSWORD."
  echo -e "  Creá el admin luego con: ${BOLD}pnpm bootstrap:admin${NC}"
fi

# ── 7. Listo ───────────────────────────────────────────────────────────────
echo -e "\n${BOLD}${GREEN}╔══════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}${GREEN}║  ✓ Setup completado exitosamente             ║${NC}"
echo -e "${BOLD}${GREEN}╚══════════════════════════════════════════════╝${NC}"
echo -e ""
echo -e "  Para levantar el servidor en modo desarrollo:"
echo -e "  ${BOLD}pnpm dev${NC}"
echo -e ""
echo -e "  API:        http://localhost:3000/api/v1"
echo -e "  Swagger UI: http://localhost:3000/api/docs"
echo -e "  DB Studio:  ${BOLD}pnpm run db:studio${NC}"
echo -e ""
