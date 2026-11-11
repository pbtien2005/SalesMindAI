# SalesMind AI: một image chứa cả API (Fastify) và giao diện (web/dist). Build ở thư mục gốc repo:
#   docker build -t salesmind .
# Cần Node 26 (.nvmrc).

# --- 1. Build giao diện ---
FROM node:26-slim AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# --- 2. Build backend và cài thư viện chạy thật ---
FROM node:26-slim AS api
WORKDIR /app
COPY backend/package.json backend/package-lock.json ./
RUN npm ci
COPY backend/tsconfig.json backend/tsconfig.build.json ./
COPY backend/src ./src
RUN npm run build
# Chỉ giữ thư viện chạy thật (bỏ typescript, vitest, tsx...).
RUN npm prune --omit=dev

# --- 3. Chạy ---
FROM node:26-slim AS run
ENV NODE_ENV=production \
    PORT=3000 \
    WEB_DIST_DIR=/app/web-dist
WORKDIR /app
COPY --from=api /app/node_modules ./node_modules
COPY --from=api /app/dist ./dist
COPY --from=api /app/package.json ./package.json
COPY backend/drizzle ./drizzle
COPY backend/demo-assets ./demo-assets
COPY --from=web /web/dist ./web-dist
USER node
EXPOSE 3000
# Migration chạy trước khi nhận yêu cầu; lỗi migration thì container dừng, không chạy với schema cũ.
# `exec` để node thay sh làm PID 1, nhận SIGTERM và tắt nhẹ nhàng (xem README, mục Vận hành).
CMD ["sh", "-c", "node dist/db/migrate.js && exec node dist/server.js"]
