#!/usr/bin/env bash
# Boot the built API image the way ECS runs it, against a throwaway Postgres,
# and fail unless the production runtime (Bun, PID 1, the image's own user and
# entrypoint) can:
#   1. apply both migrator phases with the command deploy-ecs.sh runs,
#   2. serve /health/ready with 200 from the image's default CMD,
#   3. turn SIGTERM (`docker stop`, as ECS does on a rollout) into the graceful
#      shutdown and exit 0,
# and unless the image itself holds what apps/api/Dockerfile promises:
#   4. it runs as `bun` (uid 1000), every file under /app is root-owned and
#      not writable by that user, and only /app/uploads (the local upload
#      fallback) is,
#   5. no curl or wget ships, and none of the API's devDependencies do,
#   6. its own HEALTHCHECK command passes against the booted API, fails with
#      no API to answer, and Docker itself reports the container healthy.
# A unit suite cannot see any of these: they are properties of the image.
set -euo pipefail

: "${IMAGE:?IMAGE required}"
: "${DATABASE_URL:?DATABASE_URL required (a throwaway database named nilo)}"
PORT="${PORT:-4001}"
NAME="nilo-api-smoke-$$"

cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT

# --- 4 and 5: static properties, read from the image as its own user ---
in_image() { docker run --rm --network none --entrypoint /bin/sh "$IMAGE" -c "$1"; }

user=$(in_image 'printf "%s:%s" "$(id -un)" "$(id -u)"')
if [ "$user" != bun:1000 ]; then
  echo "::error::the image runs as '$user', expected bun:1000"
  exit 1
fi

# Ownership: anything under /app not owned by root:root, outside uploads/.
foreign=$(in_image 'find /app -path /app/uploads -prune -o \( ! -user root -o ! -group root \) -print')
if [ -n "$foreign" ]; then
  head -n 20 <<<"$foreign"
  echo "::error::files under /app are not root-owned; the app user could rewrite its own code"
  exit 1
fi
# Permissions as the app user sees them: nothing writable outside uploads/,
# and a real write into the bundle, the dependencies and /app itself fails.
writable=$(in_image 'find /app -path /app/uploads -prune -o -writable -print')
if [ -n "$writable" ]; then
  head -n 20 <<<"$writable"
  echo "::error::the app user can write under /app outside /app/uploads"
  exit 1
fi
for target in /app/apps/api/dist/index.js /app/node_modules/express/package.json /app/smoke-probe; do
  if in_image "printf x >> '$target'" 2>/dev/null; then
    echo "::error::the app user wrote to $target"
    exit 1
  fi
done
if ! in_image 'printf x > /app/uploads/smoke-probe && rm /app/uploads/smoke-probe'; then
  echo "::error::the app user cannot write /app/uploads, where the local upload fallback writes"
  exit 1
fi

shipped=$(in_image 'for tool in curl wget; do command -v "$tool"; done
  for dev in vitest drizzle-kit @swc/core @swc/cli pino-pretty @biomejs/biome; do
    [ -e "/app/node_modules/$dev" ] && echo "node_modules/$dev"
  done; true')
if [ -n "$shipped" ]; then
  printf '%s\n' "$shipped"
  echo "::error::the runtime image ships a network tool or a devDependency it must not"
  exit 1
fi

# The HEALTHCHECK, exactly as the image declares it (exec form, no shell).
mapfile -d '' -t healthcheck < <(docker image inspect -f '{{json .Config.Healthcheck.Test}}' "$IMAGE" |
  python3 -c 'import json, sys
test = json.load(sys.stdin)
assert test and test[0] == "CMD", test
sys.stdout.write("\0".join(test[1:]) + "\0")')
if [ "${#healthcheck[@]}" -lt 1 ]; then
  echo "::error::the image declares no exec-form HEALTHCHECK"
  exit 1
fi
if timeout 30 docker run --rm --network none --entrypoint "${healthcheck[0]}" "$IMAGE" "${healthcheck[@]:1}"; then
  echo "::error::the HEALTHCHECK passed with no API running; it checks nothing"
  exit 1
fi

# --- 1 to 3 and 6: the image as ECS runs it ---
for phase in pre post; do
  docker run --rm --network host -e DATABASE_URL "$IMAGE" \
    bun apps/api/dist/db/migrate.js --target-database=nilo --phase="$phase"
done

docker run -d --name "$NAME" --network host -e DATABASE_URL -e PORT="$PORT" "$IMAGE" >/dev/null

ready=
for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:$PORT/health/ready" >/dev/null 2>&1; then
    ready=1
    break
  fi
  if [ "$(docker inspect -f '{{.State.Running}}' "$NAME")" != true ]; then
    break
  fi
  sleep 1
done
if [ -z "$ready" ]; then
  docker logs "$NAME" || true
  echo "::error::the API image never answered /health/ready"
  exit 1
fi

# PID 1 must be Bun running the bundle: the entrypoint execs the CMD, so a
# wrapper shell left at PID 1 would swallow the SIGTERM tested below.
pid1=$(docker exec "$NAME" cat /proc/1/cmdline | tr '\0' ' ')
case "$pid1" in
  "bun apps/api/dist/index.js "*) ;;
  *)
    echo "::error::PID 1 is '$pid1', expected 'bun apps/api/dist/index.js'"
    exit 1
    ;;
esac

if ! timeout 30 docker exec "$NAME" "${healthcheck[@]}"; then
  echo "::error::the image's HEALTHCHECK command failed against the booted API"
  exit 1
fi
# Docker's own verdict: the first probe runs one interval (30 s) after start.
health=
for _ in $(seq 1 50); do
  health=$(docker inspect -f '{{.State.Health.Status}}' "$NAME")
  [ "$health" = starting ] || break
  sleep 1
done
if [ "$health" != healthy ]; then
  docker inspect -f '{{json .State.Health}}' "$NAME" || true
  echo "::error::Docker reports the container '$health', expected healthy"
  exit 1
fi

docker stop -t 35 "$NAME" >/dev/null
exit_code=$(docker inspect -f '{{.State.ExitCode}}' "$NAME")
logs=$(docker logs "$NAME" 2>&1)
if [ "$exit_code" != 0 ] || ! grep -q 'Graceful shutdown complete' <<<"$logs"; then
  printf '%s\n' "$logs"
  echo "::error::SIGTERM did not end in a graceful exit 0 (exit code $exit_code)"
  exit 1
fi

echo "API image smoke passed: root-owned read-only code, writable uploads/ only, no curl or devDependencies, migrations, /health/ready, PID 1 = Bun, HEALTHCHECK healthy, graceful SIGTERM"
