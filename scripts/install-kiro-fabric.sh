#!/bin/sh
# Friendly POSIX bootstrap for Kiro Fabric (Linux and macOS).
#
# From a source checkout this script checks the runtime, prepares dependencies
# and builds the compiled installer when needed, then hands off to the verified
# setup console. A bare run installs at user scope with approval prompts intact;
# trusted tool auto-approval is available only through an explicit flag.
#
# Environment overrides:
#   KIRO_FABRIC_SETUP_ENTRY  alternate compiled setup entry (primarily tests)
#   KIRO_FABRIC_AUTO_BUILD=1 explicitly allow non-interactive source preparation
#   KIRO_FABRIC_AUTO_BUILD=0 never install dependencies or build automatically
#   KIRO_FABRIC_REBUILD=1    rebuild even when the compiled entry already exists
#   NO_COLOR                 disable ANSI styling

set -eu

INTERACTIVE=0
if [ -t 0 ] && [ -t 1 ] && [ -t 2 ]; then INTERACTIVE=1; fi

if [ "$INTERACTIVE" -eq 1 ] && [ -z "${NO_COLOR:-}" ]; then
  RESET=$(printf '\033[0m')
  BOLD=$(printf '\033[1m')
  DIM=$(printf '\033[2m')
  CYAN=$(printf '\033[36m')
  GREEN=$(printf '\033[32m')
  YELLOW=$(printf '\033[33m')
  RED=$(printf '\033[31m')
else
  RESET=''; BOLD=''; DIM=''; CYAN=''; GREEN=''; YELLOW=''; RED=''
fi

banner() {
  [ "$INTERACTIVE" -eq 1 ] || return 0
  printf '%s\n' \
    "${CYAN}${BOLD}╭──────────────────────────────────────────╮${RESET}" \
    "${CYAN}${BOLD}│          Kiro Fabric Installer           │${RESET}" \
    "${CYAN}${BOLD}╰──────────────────────────────────────────╯${RESET}" \
    "${DIM}  Safe setup for the managed Kiro v3 profile${RESET}" \
    ''
}

step() { [ "$INTERACTIVE" -eq 1 ] && printf '  %s◆%s %s\n' "$CYAN" "$RESET" "$1" || true; }
ok() { [ "$INTERACTIVE" -eq 1 ] && printf '  %s✓%s %s\n' "$GREEN" "$RESET" "$1" || true; }
warn() { printf '%sWARNING%s %s\n' "$YELLOW" "$RESET" "$1" >&2; }
fail() { printf '%sERROR%s %s\n' "$RED" "$RESET" "$1" >&2; exit 1; }

print_node_guidance() {
  printf '%s\n' "$1" >&2
  printf '%s\n' \
    'Kiro Fabric requires Node.js 24 or newer.' \
    '' \
    'Install Node.js 24+ from https://nodejs.org/' \
    '  Debian/Ubuntu:   use NodeSource setup_24 or another current Node installer' \
    '  Fedora/RHEL:     sudo dnf install -y nodejs' \
    '  macOS (Homebrew): brew install node@24' \
    '  nvm:             nvm install 24' \
    'Then reopen your terminal and run this installer again.' >&2
}

banner
step 'Checking Node.js'
if ! NODE_BIN=$(command -v node 2>/dev/null); then
  print_node_guidance 'ERROR Node.js was not found on PATH.'
  exit 1
fi
NODE_VER=$("$NODE_BIN" --version 2>/dev/null || true)
case $NODE_VER in v[0-9]*) ;; *)
  print_node_guidance "ERROR Node.js ${NODE_VER:-\(unknown\)} was found, but version 24 or newer is required."
  exit 1
esac
NODE_MAJOR=${NODE_VER#v}; NODE_MAJOR=${NODE_MAJOR%%.*}
case $NODE_MAJOR in ''|*[!0-9]*)
  print_node_guidance "ERROR Node.js $NODE_VER was found, but version 24 or newer is required."
  exit 1 ;;
esac
if [ "$NODE_MAJOR" -lt 24 ]; then
  print_node_guidance "ERROR Node.js $NODE_VER was found, but version 24 or newer is required."
  exit 1
fi
ok "Node.js $NODE_VER"

case $(uname -s 2>/dev/null || printf unknown) in
  Darwin|Linux) ;;
  *) fail 'this installer supports Linux and macOS only' ;;
esac

SELF=$0
symlink_hops=0
while [ -L "$SELF" ]; do
  LINK_TARGET=$(readlink "$SELF" 2>/dev/null) || break
  case $LINK_TARGET in /*) SELF=$LINK_TARGET ;; *) SELF=$(dirname -- "$SELF")/$LINK_TARGET ;; esac
  symlink_hops=$((symlink_hops + 1))
  [ "$symlink_hops" -lt 40 ] || fail 'too many installer symlink hops'
done
ROOT=$(CDPATH= cd -- "$(dirname -- "$SELF")/.." 2>/dev/null && pwd -P) || fail "cannot resolve repository root from: $SELF"
ENTRY=${KIRO_FABRIC_SETUP_ENTRY:-$ROOT/dist/kiro/setup-entry.js}

PNPM_VERSION=11.20.0
run_pnpm() {
  if command -v pnpm >/dev/null 2>&1; then
    pnpm "$@"
  elif command -v corepack >/dev/null 2>&1; then
    corepack pnpm@"$PNPM_VERSION" "$@"
  else
    fail "pnpm $PNPM_VERSION was not found. Install it with: npm install --global pnpm@$PNPM_VERSION"
  fi
}

require_pinned_pnpm() {
  FOUND_PNPM_VERSION=$(run_pnpm --version) || fail "could not run pnpm $PNPM_VERSION"
  [ "$FOUND_PNPM_VERSION" = "$PNPM_VERSION" ] ||
    fail "source preparation requires pnpm $PNPM_VERSION (found $FOUND_PNPM_VERSION)"
}

confirm_source_preparation() {
  printf '%s' 'Install dependencies and build this source checkout? [y/N] ' >&2
  if ! IFS= read -r ANSWER; then return 1; fi
  case $ANSWER in y|Y|yes|YES|Yes) return 0 ;; *) return 1 ;; esac
}

NEEDS_BUILD=0
[ -f "$ENTRY" ] || NEEDS_BUILD=1
[ "${KIRO_FABRIC_REBUILD:-0}" = 1 ] && NEEDS_BUILD=1

if [ "$NEEDS_BUILD" -eq 1 ]; then
  [ "${KIRO_FABRIC_AUTO_BUILD:-}" != 0 ] || fail "setup entry not found: $ENTRY (run pnpm install && pnpm run build)"
  [ -f "$ROOT/package.json" ] || fail "setup entry not found: $ENTRY"

  PREPARE_CONFIRMED=0
  [ "${KIRO_FABRIC_AUTO_BUILD:-}" = 1 ] && PREPARE_CONFIRMED=1
  [ "${KIRO_FABRIC_REBUILD:-0}" = 1 ] && PREPARE_CONFIRMED=1
  for ARG in "$@"; do
    [ "$ARG" = "--yes" ] && PREPARE_CONFIRMED=1
  done
  if [ "$PREPARE_CONFIRMED" -ne 1 ]; then
    if [ "$INTERACTIVE" -eq 1 ]; then
      confirm_source_preparation || fail 'source preparation cancelled; no dependencies were installed'
    else
      fail 'source preparation requires consent; pass --yes, set KIRO_FABRIC_AUTO_BUILD=1, or run pnpm install && pnpm run build first'
    fi
  fi

  warn 'compiled installer is missing; preparing this source checkout now'
  require_pinned_pnpm
  step 'Installing project dependencies'
  (cd "$ROOT" && run_pnpm install --frozen-lockfile)
  ok 'Dependencies ready'
  step 'Building Kiro Fabric'
  (cd "$ROOT" && run_pnpm run build)
  [ -f "$ENTRY" ] || fail "build completed but setup entry is still missing: $ENTRY"
  ok 'Build complete'
else
  ok 'Compiled installer ready'
fi

# This source installer intentionally manages only the user-scoped profile.
# Bind the managed profile to the checkout (or an explicit workspace), never to
# the Kiro config home that stores agent profiles and MCP configuration.
DEFAULT_PROJECT_ROOT=${KIRO_FABRIC_PROJECT_ROOT:-$ROOT}
if [ ! -d "$DEFAULT_PROJECT_ROOT" ]; then
  fail "project root does not exist: $DEFAULT_PROJECT_ROOT"
fi
DEFAULT_PROJECT_ROOT=$(CDPATH= cd -- "$DEFAULT_PROJECT_ROOT" 2>/dev/null && pwd -P) ||
  fail "cannot resolve project root: $DEFAULT_PROJECT_ROOT"
if [ "$#" -eq 0 ]; then
  set -- install --user --project-root "$DEFAULT_PROJECT_ROOT"
else
  COMMAND=$1
  HAS_PROJECT_ROOT=0
  for ARG in "$@"; do
    [ "$ARG" = "--project-root" ] && HAS_PROJECT_ROOT=1
  done
  case $COMMAND in
    install|update|repair)
      HAS_USER=0
      for ARG in "$@"; do
        [ "$ARG" = "--user" ] && HAS_USER=1
      done
      [ "$HAS_USER" -eq 1 ] || set -- "$@" --user
      [ "$HAS_PROJECT_ROOT" -eq 1 ] || set -- "$@" --project-root "$DEFAULT_PROJECT_ROOT"
      ;;
    uninstall)
      HAS_USER=0
      for ARG in "$@"; do
        [ "$ARG" = "--user" ] && HAS_USER=1
      done
      [ "$HAS_USER" -eq 1 ] || set -- "$@" --user
      [ "$HAS_PROJECT_ROOT" -eq 1 ] || set -- "$@" --project-root "$DEFAULT_PROJECT_ROOT"
      ;;
    doctor)
      HAS_USER=0
      for ARG in "$@"; do
        [ "$ARG" = "--user" ] && HAS_USER=1
      done
      [ "$HAS_USER" -eq 1 ] || set -- "$@" --user
      [ "$HAS_PROJECT_ROOT" -eq 1 ] || set -- "$@" --project-root "$DEFAULT_PROJECT_ROOT"
      ;;
    status|launch)
      [ "$HAS_PROJECT_ROOT" -eq 1 ] || set -- "$@" --project-root "$DEFAULT_PROJECT_ROOT"
      ;;
  esac
fi

if [ "$INTERACTIVE" -eq 1 ]; then
  HAS_ALLOW_TOOLS=0
  for ARG in "$@"; do
    [ "$ARG" = "--allow-tools" ] && HAS_ALLOW_TOOLS=1
  done
  if [ "$HAS_ALLOW_TOOLS" -eq 1 ]; then
    printf '\n  %sTrusted grant:%s Kiro will auto-approve only fabric/fabric_exec.\n' "$YELLOW" "$RESET"
    printf '  The grant is bound to this canonical project directory.\n'
  fi
  printf '\n  %sLaunching user-scope setup…%s\n\n' "$BOLD" "$RESET"
fi
exec "$NODE_BIN" "$ENTRY" "$@"
