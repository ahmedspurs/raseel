#!/bin/sh
# Removes packages the production image never loads. The Prisma CLI arrives as a
# peer of @prisma/client, but production applies migrations with dist/migrate.js,
# so the CLI, Prisma Studio and their dependencies are dead weight (~250 MB).
set -eu
cd "${1:-/app/node_modules/.pnpm}"

CLI_ONLY="prisma @prisma+studio-core @prisma+dev @prisma+engines @prisma+engines-version \
  @prisma+fetch-engine @prisma+get-platform @prisma+streams-local @prisma+query-plan-executor \
  @prisma+config effect @electric-sql+pglite @electric-sql+pglite-socket \
  @electric-sql+pglite-tools react react-dom elkjs"

for pkg in $CLI_ONLY; do
  rm -rf "${pkg}"@* 2>/dev/null || true
  # pnpm 12 also hoists packages: scoped ones under .pnpm/@scope/<name>,
  # unscoped ones under .pnpm/@/<name>.
  name=$(echo "$pkg" | sed 's/+/\//')
  case "$name" in
    @*) rm -rf "${name}" 2>/dev/null || true ;;
    *) rm -rf "@/${name}" 2>/dev/null || true ;;
  esac
done

# Raseel uses PostgreSQL only: drop query compilers for other databases.
for dir in @prisma+client@*/node_modules/@prisma/client/runtime @prisma/client/runtime; do
  [ -d "$dir" ] || continue
  find "$dir" -type f \( -name '*cockroachdb*' -o -name '*mysql*' -o -name '*sqlite*' -o -name '*sqlserver*' \) -delete
done
