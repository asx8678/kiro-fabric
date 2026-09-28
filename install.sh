#!/bin/sh
# Build this checkout and install it as the kiro-fabric Kiro agent.
set -eu
umask 077
base=$(CDPATH= cd -P -- "$(dirname "$0")" && pwd -P)
node=$(command -v node) || { echo 'Kiro Fabric: Node >=24 is required.' >&2; exit 1; }
for argument in "$@"; do
  case "$argument" in
    --help|-h|--uninstall) exec "$node" "$base/scripts/install.mjs" "$@";;
  esac
done
command -v pnpm >/dev/null 2>&1 || { echo 'Kiro Fabric: pnpm is required.' >&2; exit 1; }
cd "$base"
pnpm install --frozen-lockfile
pnpm run build
exec "$node" "$base/scripts/install.mjs" --node "$node" "$@"
