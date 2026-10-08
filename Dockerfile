# Imagen de producción (Railway). Debian y no Alpine: el Chrome de Puppeteer
# necesita glibc, y el Chromium de Alpine no trae el sandbox SUID.

FROM node:24-slim AS builder
WORKDIR /app
RUN corepack enable
# Chrome se instala en la etapa final, con sus dependencias de sistema.
ENV PUPPETEER_SKIP_DOWNLOAD=true
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build && pnpm prune --prod


FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production \
    PUPPETEER_CACHE_DIR=/app/.cache/puppeteer

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package.json drizzle.config.ts ./
COPY drizzle ./drizzle

# Chrome en la versión que fija puppeteer, más sus librerías (--install-deps
# lee el deb.deps del propio Chrome). fonts-liberation: los PDF piden Arial y
# un contenedor pelado no tiene ninguna fuente. unzip sólo hace falta para
# descomprimir Chrome.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates fonts-liberation unzip \
 && node_modules/.bin/puppeteer browsers install chrome --install-deps \
 && apt-get purge -y unzip && apt-get autoremove -y \
 && rm -rf /var/lib/apt/lists/*

# Chrome no corre como root: así arrancaría sólo con --no-sandbox. Si el
# sandbox no arranca en Railway se apaga con CHROME_SIN_SANDBOX=true (ver
# src/common/chrome.ts), no aquí.
RUN chown -R node:node "$PUPPETEER_CACHE_DIR"
USER node
EXPOSE 3000
CMD ["node", "dist/src/main"]
