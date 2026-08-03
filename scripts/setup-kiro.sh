#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if ! command -v pnpm >/dev/null 2>&1; then
  echo "Error: pnpm is required. Install it with: corepack enable" >&2
  exit 3
fi

if ! command -v kiro-cli >/dev/null 2>&1; then
  echo "Error: kiro-cli was not found in PATH." >&2
  exit 3
fi

echo "==> Installing Fabric Lite dependencies"
pnpm install --frozen-lockfile

echo "==> Building Fabric Lite"
pnpm build

echo "==> Installing Kiro agents and project configuration"
node "$ROOT/dist/cli/main.js" install-kiro --format json "$@"

# A dry run intentionally does not create agents, so doctor would report them missing.
for arg in "$@"; do
  if [[ "$arg" == "--dry-run" ]]; then
    echo "==> Dry run complete; no files were changed"
    exit 0
  fi
done

echo "==> Verifying installation"
node "$ROOT/dist/cli/main.js" doctor --format json

echo
echo "Fabric Lite is ready. Launch it with:"
echo "  kiro-cli --agent fabric-lite"