# ==========================================
# Multi-Stage Production Dockerfile
# ==========================================

# 1. Base stage with Node LTS Alpine
FROM node:22-alpine AS base
WORKDIR /app
RUN apk add --no-cache libc6-compat

# 2. Dependencies stage (installs all dependencies including dev)
FROM base AS dependencies
COPY package.json package-lock.json ./
RUN npm ci || npm install

# 3. Builder stage (compiles TypeScript and generates Prisma client)
FROM base AS builder
ENV DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder"
COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json package-lock.json tsconfig*.json nest-cli.json ./
COPY prisma.config.ts ./
COPY prisma ./prisma
COPY src ./src

# Generate Prisma Client and build NestJS
RUN npm run prisma:generate
RUN npm run build

# Remove development dependencies for lean production image
RUN npm prune --omit=dev

# 4. Production Runner stage
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Install curl for Docker health check
RUN apk add --no-cache curl

# Run as non-root user for security
USER node

# Copy production artifacts and generated client
COPY --chown=node:node --from=builder /app/package.json ./package.json
COPY --chown=node:node --from=builder /app/node_modules ./node_modules
COPY --chown=node:node --from=builder /app/dist ./dist
COPY --chown=node:node --from=builder /app/src/generated ./src/generated
COPY --chown=node:node --from=builder /app/prisma ./prisma
COPY --chown=node:node --from=builder /app/prisma.config.ts ./prisma.config.ts

EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3000/health/live || exit 1

CMD ["node", "dist/main.js"]
