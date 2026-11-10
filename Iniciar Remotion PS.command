#!/bin/zsh
set -euo pipefail
TASK_ROOT="${0:A:h}"
cd "$TASK_ROOT/apps/ps-editor"
if [[ -x node_modules/.bin/bun ]]; then
  TASK_BUN="$PWD/node_modules/.bin/bun"
elif command -v bun >/dev/null 2>&1; then
  TASK_BUN="$(command -v bun)"
else
  echo 'Instalando o runtime Bun local (uma vez)…'
  npm install --prefix .runtime bun@1.4.4 --no-audit --no-fund
  TASK_BUN="$PWD/.runtime/node_modules/.bin/bun"
fi
export PATH="${TASK_BUN:h}:$PATH"
if [[ ! -d node_modules/react ]]; then "$TASK_BUN" install; fi
if [[ ! -f dist/index.html ]]; then "$TASK_BUN" run build; fi
TASK_PORT="${REMOTION_PS_PORT:-4173}"
if curl --silent --fail "http://127.0.0.1:$TASK_PORT/api/session" >/dev/null; then
  open "http://127.0.0.1:$TASK_PORT"
  exit 0
fi
( for attempt in {1..30}; do
    if curl --silent --fail "http://127.0.0.1:$TASK_PORT/api/session" >/dev/null; then
      open "http://127.0.0.1:$TASK_PORT"; exit 0
    fi
    sleep 1
  done
) &
echo "Remotion PS — servidor local. Feche com Control+C neste Terminal."
exec "$TASK_BUN" server.ts --production
