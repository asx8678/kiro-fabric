#!/bin/sh
# install-kiro-fabric.sh - POSIX sh bootstrap for the Kiro Fabric installer.
#
# Supported platforms: Linux and macOS only (no Windows).
# Responsibilities are deliberately minimal:
#   1. Locate a Node.js runtime on PATH and require major version >= 24.
#   2. Resolve the repository root (this script lives in <repo>/scripts/).
#   3. exec the compiled setup entry <repo>/dist/kiro/setup-entry.js,
#      passing every argument through unchanged.
#
# No curl|sh, no network access, no .kiro access, no filesystem writes.
# All flag parsing belongs to the setup entry, not to this bootstrap.
#
# Environment overrides (intended for tests):
#   KIRO_FABRIC_SETUP_ENTRY  path to the setup entry JS file; overrides
#                            the default $ROOT/dist/kiro/setup-entry.js.

set -eu

# Print the Node.js guidance block. $1 = the exact first ERROR line.
print_node_guidance() {
  printf '%s\n' "$1" >&2
  # Shell builtins only: this guidance must still print when PATH is broken
  # and external commands such as cat cannot be located.
  printf '%s\n' \
    'Kiro Fabric requires Node.js 24 or newer.' \
    '' \
    'Install Node.js 24+ from https://nodejs.org/' \
    '  Debian/Ubuntu:  sudo apt-get install -y nodejs npm   (or nodesource setup_24)' \
    '  Fedora/RHEL:    sudo dnf install -y nodejs' \
    '  macOS (Homebrew): brew install node@24' \
    '  Or with nvm:    nvm install 24' \
    'Then reopen your terminal and run this installer again.' >&2
}

fail_node_missing() {
  print_node_guidance 'ERROR Node.js was not found on PATH.'
  exit 1
}

fail_node_version() {
  ver=$1
  [ -n "$ver" ] || ver='(unknown)'
  print_node_guidance "ERROR Node.js $ver was found, but version 24 or newer is required."
  exit 1
}

# --- Locate node -------------------------------------------------------------

if ! NODE_BIN=$(command -v node 2>/dev/null); then
  fail_node_missing
fi

NODE_VER=$("$NODE_BIN" --version 2>/dev/null || true)

case $NODE_VER in
  v[0-9]*.[0-9]*) ;;
  *) fail_node_version "$NODE_VER" ;;
esac

NODE_MAJOR=${NODE_VER#v}
NODE_MAJOR=${NODE_MAJOR%%.*}
case $NODE_MAJOR in
  ''|*[!0-9]*) fail_node_version "$NODE_VER" ;;
esac

if [ "$NODE_MAJOR" -lt 24 ]; then
  fail_node_version "$NODE_VER"
fi

# --- Resolve this script and the repository root -----------------------------

# Resolve $0 through any symlinks so an installer symlinked elsewhere still
# finds the repository root it belongs to.
SELF=$0
symlink_hops=0
while [ -L "$SELF" ]; do
  LINK_TARGET=$(readlink "$SELF" 2>/dev/null) || break
  case $LINK_TARGET in
    /*) SELF=$LINK_TARGET ;;
    *) SELF=$(dirname -- "$SELF")/$LINK_TARGET ;;
  esac
  symlink_hops=$((symlink_hops + 1))
  [ "$symlink_hops" -lt 40 ] || break
done

ROOT=$(CDPATH= cd -- "$(dirname -- "$SELF")/.." 2>/dev/null && pwd -P) || {
  printf 'ERROR cannot resolve repository root from: %s\n' "$SELF" >&2
  exit 1
}

ENTRY=${KIRO_FABRIC_SETUP_ENTRY:-$ROOT/dist/kiro/setup-entry.js}

if [ ! -f "$ENTRY" ]; then
  printf 'ERROR setup entry not found: %s (run pnpm build first)\n' "$ENTRY" >&2
  exit 1
fi

exec "$NODE_BIN" "$ENTRY" "$@"
