# syntax=docker/dockerfile:1
# The image Coolify runs and `npm run docker:up` checks locally (PLAN §17.3): the Nest server
# serving the built game on port 3000, as the non-root `node` user.
ARG NODE_IMAGE=node:24-alpine

# All dependencies, for the build. Only the manifests are copied, so this layer is reused until
# they change.
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY apps/server/package.json apps/server/
RUN npm ci --no-audit --no-fund

FROM deps AS build
COPY . .
RUN npm run build -w @rb/web && npm run build -w @rb/server

# Only the server's production dependencies: no React, Vite or dev tools in the runtime image.
FROM ${NODE_IMAGE} AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY apps/server/package.json apps/server/
RUN npm ci --omit=dev --workspace @rb/server --no-audit --no-fund

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production PORT=3000
WORKDIR /app
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
# "type": "module" for dist/*.js, and the version /api/health reports.
COPY --chown=node:node apps/server/package.json apps/server/
COPY --from=build --chown=node:node /app/apps/server/dist apps/server/dist
COPY --from=build --chown=node:node /app/apps/web/dist apps/web/dist
USER node
EXPOSE 3000
# 127.0.0.1, not localhost (which can resolve to ::1 on Alpine); no curl needed.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node","-e","fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
WORKDIR /app/apps/server
# node is PID 1 and handles SIGTERM (enableShutdownHooks); never `npm start` here.
CMD ["node","dist/main.js"]
