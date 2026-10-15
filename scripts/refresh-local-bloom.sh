#!/usr/bin/env bash
# Repack @oxy.so/bloom-text and @oxy.so/bloom-editor from a local Bloom
# checkout into .local-packages/ and reinstall them, until both are on npm.
#   BLOOM_DIR=~/Oxy/Bloom/.worktrees/bloom-text scripts/refresh-local-bloom.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BLOOM_DIR="${BLOOM_DIR:?set BLOOM_DIR to the Bloom checkout holding packages/}"
mkdir -p "$ROOT/.local-packages"
rm -f "$ROOT"/.local-packages/*.tgz
for pkg in bloom-text bloom-editor; do
  (cd "$BLOOM_DIR/packages/$pkg" && rm -rf lib && bun run build >/dev/null && bun pm pack --destination "$ROOT/.local-packages" >/dev/null)
done
# The lockfile pins each tarball's hash; drop those entries so the new ones install.
python3 - "$ROOT/bun.lock" <<'PY'
import re, sys
path = sys.argv[1]
text = open(path).read()
text = re.sub(r'\n\s*"@oxy\.so/bloom-(text|editor)": \["@oxy\.so/bloom-\1@[^\n]*\.tgz"[^\n]*\n', '\n', text)
open(path, 'w').write(text)
PY
rm -rf "$ROOT"/node_modules/@oxy.so/bloom-text "$ROOT"/node_modules/@oxy.so/bloom-editor
(cd "$ROOT" && bun install >/dev/null)
echo "refreshed: $(ls "$ROOT/.local-packages")"
