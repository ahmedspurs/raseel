#!/bin/sh
set -e

case "$1" in
  api)
    # Apply pending migrations before serving (NFR-15: one-command install/update).
    node_modules/.bin/prisma migrate deploy
    exec node dist/server.js
    ;;
  worker)
    exec node dist/worker.js
    ;;
  migrate)
    exec node_modules/.bin/prisma migrate deploy
    ;;
  *)
    exec "$@"
    ;;
esac
