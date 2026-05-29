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
ok "docker y pnpm encontrados"

# ── 2. Archivo .env ────────────────────────────────────────────────────────
step "Configurando variables de entorno"

if [ ! -f ".env" ]; then
  cp .env.example .env
  echo -e "${YELLOW}  Se creó .env desde .env.example"
  echo -e "  ⚠  Edita .env con tus credenciales de Supabase antes de continuar."
  echo -e "  Presiona ENTER cuando hayas guardado los cambios...${NC}"
  read -r
else
  ok ".env ya existe, omitiendo"
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

# Esperar a que PostgreSQL esté listo
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

# ── 5. Generar migraciones Drizzle ─────────────────────────────────────────
step "Generando migraciones Drizzle desde el schema"

pnpm run db:generate
ok "Migraciones generadas en ./drizzle"

# ── 6. Aplicar migraciones ─────────────────────────────────────────────────
step "Aplicando migraciones a la base de datos"

pnpm run db:migrate
ok "Migraciones aplicadas"

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
