# Raseel API and worker image (same image, different command).

FROM node:22-alpine AS base
RUN npm install -g pnpm@12.3.4 && apk add --no-cache libc6-compat
WORKDIR /app

# ── Build: compile shared package and API ──
FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm install --frozen-lockfile --filter "@raseel/api..."
RUN pnpm --filter @raseel/shared build && pnpm --filter @raseel/api build

# ── Production dependencies only ──
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/prisma.config.ts apps/api/
COPY apps/api/prisma apps/api/prisma
RUN pnpm install --frozen-lockfile --prod --filter "@raseel/api..."

# ── Runtime ──
FROM node:22-alpine AS runtime
# ffmpeg converts browser voice recordings to OGG/Opus for WhatsApp.
RUN apk add --no-cache libc6-compat tini ffmpeg
ENV NODE_ENV=production \
    NODE_OPTIONS=--max-old-space-size=384
WORKDIR /app
COPY --from=deps /app/node_modules node_modules
COPY --from=deps /app/packages/shared/node_modules packages/shared/node_modules
COPY --from=deps /app/apps/api/node_modules apps/api/node_modules
COPY --from=build /app/packages/shared/package.json packages/shared/
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/apps/api/package.json /app/apps/api/prisma.config.ts apps/api/
COPY --from=build /app/apps/api/prisma apps/api/prisma
COPY --from=build /app/apps/api/dist apps/api/dist
COPY docker/api-entrypoint.sh /usr/local/bin/raseel-entrypoint
RUN chmod +x /usr/local/bin/raseel-entrypoint && mkdir -p /data/media && chown -R node:node /data

WORKDIR /app/apps/api
USER node
EXPOSE 4000
ENTRYPOINT ["/sbin/tini", "--", "raseel-entrypoint"]
CMD ["api"]
