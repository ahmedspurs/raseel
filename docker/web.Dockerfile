# Raseel web: the static Nuxt build served by Caddy, which also proxies the API
# and obtains HTTPS certificates automatically.

FROM node:22-alpine AS build
RUN npm install -g pnpm@12.3.4
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN pnpm install --frozen-lockfile --filter "@raseel/web..."
RUN pnpm --filter @raseel/shared build && pnpm --filter @raseel/web build

FROM caddy:2-alpine
COPY docker/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/apps/web/.output/public /srv
