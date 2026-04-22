FROM node:20-bookworm-slim AS base

# Dependências de build pra better-sqlite3, pdf-parse e poppler-utils (pdftoppm usado por render.ts)
RUN apt-get update && apt-get install -y --no-install-recommends \
  python3 make g++ poppler-utils ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# --------- deps stage (npm ci com lockfile — inclui dev deps pro build) ---------
FROM base AS deps
WORKDIR /app
ENV NODE_ENV=development
COPY package.json package-lock.json ./
RUN npm ci --include=dev

# --------- builder stage (compila Next.js standalone) ---------
FROM base AS builder
WORKDIR /app
ENV NODE_ENV=development
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# --------- runner stage (imagem final) ---------
FROM node:20-bookworm-slim AS runner
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
  poppler-utils ca-certificates \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3031
ENV HOSTNAME=0.0.0.0

RUN groupadd --gid 1001 nodejs && useradd --uid 1001 --gid nodejs --shell /bin/bash --create-home nextjs

# Copia o output standalone do Next (contém server.js minimal + deps necessárias)
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# better-sqlite3 precisa ser copiado inteiro (binary nativo)
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/better-sqlite3 ./node_modules/better-sqlite3
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/bindings ./node_modules/bindings
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/file-uri-to-path ./node_modules/file-uri-to-path

# Volumes persistentes: banco e logs
RUN mkdir -p /app/data /app/logs && chown -R nextjs:nodejs /app/data /app/logs
VOLUME ["/app/data", "/app/logs"]

USER nextjs
EXPOSE 3031

CMD ["node", "server.js"]
