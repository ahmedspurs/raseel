# Raseel API and worker image (same image, different command).

FROM node:22-alpine AS base
RUN npm install -g pnpm@12.3.4 && apk add --no-cache libc6-compat
WORKDIR /app

# ── Build: compile, then deploy the API with production dependencies only ──
FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm install --frozen-lockfile --filter "@raseel/api..."
RUN pnpm --filter @raseel/shared build && pnpm --filter @raseel/api build
# `pnpm deploy` copies just the API and its production dependency tree.
RUN pnpm --filter @raseel/api deploy --prod --legacy /out
COPY docker/prune-prod-deps.sh /tmp/prune-prod-deps.sh
RUN sh /tmp/prune-prod-deps.sh /out/node_modules/.pnpm

# ── Runtime ──
FROM node:22-alpine AS runtime
# ffmpeg converts browser voice recordings to OGG/Opus for WhatsApp.
RUN apk add --no-cache libc6-compat tini ffmpeg
ENV NODE_ENV=production \
    NODE_OPTIONS=--max-old-space-size=384
WORKDIR /app
COPY --from=build /out/node_modules node_modules
COPY --from=build /out/package.json package.json
COPY --from=build /app/apps/api/dist dist
COPY --from=build /app/apps/api/prisma/migrations prisma/migrations
COPY docker/api-entrypoint.sh /usr/local/bin/raseel-entrypoint
RUN chmod +x /usr/local/bin/raseel-entrypoint && mkdir -p /data/media && chown -R node:node /data

USER node
EXPOSE 4000
ENTRYPOINT ["/sbin/tini", "--", "raseel-entrypoint"]
CMD ["api"]
