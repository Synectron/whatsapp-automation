# ── Build stage ────────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS build
WORKDIR /app

# Native deps for better-sqlite3 rebuilds
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_DOWNLOAD=true
COPY package*.json ./
RUN npm ci

COPY tsconfig*.json ./
COPY scripts ./scripts
COPY src ./src
RUN npm run build && npm prune --omit=dev

# ── Runtime stage ──────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runtime
WORKDIR /app

# Chromium + fonts required by whatsapp-web.js (puppeteer)
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium \
      fonts-liberation fonts-noto-color-emoji \
      ca-certificates dumb-init tini \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    PUPPETEER_SKIP_DOWNLOAD=true \
    WHATSAPP_EXECUTABLE_PATH=/usr/bin/chromium \
    WHATSAPP_PUPPETEER_ARGS=--no-sandbox,--disable-setuid-sandbox,--disable-dev-shm-usage,--disable-gpu

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package*.json ./

RUN mkdir -p /app/data /app/logs /app/backups && chown -R node:node /app
USER node

EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/server.js"]
