# Multi-stage production Dockerfile for ComplianceGate-MCP
# 1) Builds the native Go screening & parser binary (compliancegate-core)
# 2) Builds the TypeScript/React web workbench & gateway
# 3) Includes LICENSE, separates read-only watchlist mounts (/app/lists) from writable state (/app/data), and runs as non-root user (node)

FROM golang:1.22-alpine AS go-builder
WORKDIR /go-build
COPY core ./core
RUN cd core && CGO_ENABLED=0 go build -o /go-build/compliancegate-core ./cmd/compliancegate-core

FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json LICENSE ./
RUN npm ci

COPY index.html vite.config.ts tsconfig.json server.ts ./
COPY src ./src
COPY api ./api
COPY core ./core
RUN npm run build

FROM node:22-alpine AS runner

WORKDIR /app

RUN apk add --no-cache sqlite

ENV NODE_ENV=production \
    PORT=3000 \
    IS_PUBLIC_DEMO=true \
    DATA_DIR=/app/data \
    WATCHLIST_DIRS=/app/lists \
    LIST_FOLDERS=/app/lists \
    OFAC_LIST_DIR=/app/lists/ofac \
    EU_LIST_DIR=/app/lists/eu \
    UN_LIST_DIR=/app/lists/un \
    UK_LIST_DIR=/app/lists/uk \
    VESSEL_LIST_DIR=/app/lists/vessels

COPY --from=builder --chown=node:node /app/LICENSE /app/package.json /app/package-lock.json ./
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/server.ts /app/tsconfig.json ./
COPY --from=builder --chown=node:node /app/src ./src
COPY --from=builder --chown=node:node /app/api ./api
COPY --from=builder --chown=node:node /app/core ./core
COPY --from=go-builder --chown=node:node /go-build/compliancegate-core ./core/bin/compliancegate-core

# Separate read-only list directories (/app/lists) from writable state & backups (/app/data)
RUN mkdir -p /app/lists/ofac /app/lists/eu /app/lists/un /app/lists/uk /app/lists/vessels /app/lists/licensed /app/lists/internal \
    && mkdir -p /app/data/backups \
    && chmod -R 555 /app/lists \
    && chown -R node:node /app/data

VOLUME ["/app/lists", "/app/data"]

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3000/health || exit 1

CMD ["npm", "start"]
