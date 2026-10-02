FROM node:20-slim AS builder

RUN apt-get update -qq && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files and prisma schema first (needed for postinstall prisma generate)
COPY package.json package-lock.json ./
COPY prisma/schema.prisma prisma/schema.prisma

# Install all dependencies (postinstall runs prisma generate with schema available)
RUN npm ci --legacy-peer-deps

# Copy rest of source code
COPY . .

# Build NestJS
RUN npm run build

# --- Production stage ---
FROM node:20-slim AS runner

ARG POSTGRES_CLIENT_MAJOR=18
RUN apt-get update -qq \
    && apt-get install -y --no-install-recommends ca-certificates curl gnupg gosu openssl \
    && install -d -m 0755 /usr/share/postgresql-common/pgdg \
    && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
       | gpg --dearmor -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.gpg \
    && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.gpg] https://apt.postgresql.org/pub/repos/apt $(. /etc/os-release && echo ${VERSION_CODENAME})-pgdg main" \
       > /etc/apt/sources.list.d/pgdg.list \
    && apt-get update -qq \
    && apt-get install -y --no-install-recommends "postgresql-client-${POSTGRES_CLIENT_MAJOR}" \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy only what's needed for production
COPY --chown=node:node --from=builder /app/package.json ./
COPY --chown=node:node --from=builder /app/dist ./dist
COPY --chown=node:node --from=builder /app/prisma ./prisma
COPY --chown=node:node --from=builder /app/scripts ./scripts
COPY --chown=node:node --from=builder /app/node_modules ./node_modules

RUN mkdir -p /data/backups /data/plugins /data/plugin-data /data/update-state /data/marketplace-identity \
    && chown -R node:node /data

ENV NODE_ENV=production
ENV PROCESS_ROLE=combined

EXPOSE 3001
EXPOSE 3002

CMD ["sh", "-c", "mkdir -p /data/backups /data/plugins /data/plugin-data /data/update-state /data/marketplace-identity && chown -R node:node /data && gosu node node scripts/deploy-migrations.js && exec gosu node node dist/main"]
