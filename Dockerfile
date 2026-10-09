# API server image for Google Cloud Run (artifacts/api-server).
# Build from the repo root:  gcloud run deploy ewb-api --source .
# See docs/DEPLOY.md for the full setup.

FROM node:24-slim AS build
WORKDIR /repo
# The committed lockfile is pnpm 9 compatible (pnpm 10 also applies the
# pnpm-workspace.yaml overrides and rejects it as frozen).
RUN npm install -g pnpm@9.15.9
COPY . .
RUN pnpm install --frozen-lockfile --filter @workspace/api-server... \
  && pnpm --filter @workspace/api-server run build

# The esbuild bundle is self-contained, so the runtime image needs no node_modules.
FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /repo/artifacts/api-server/dist ./dist
EXPOSE 8080
CMD ["node", "--enable-source-maps", "dist/index.mjs"]
