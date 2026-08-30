#!/usr/bin/env bash
# Controller-side launcher for blinded candidates. This file and its literal
# treatment selection are deliberately outside the candidate mount namespace.
set -euo pipefail

BWRAP=/usr/bin/bwrap
if [[ "${BENCH_TEST_MODE:-}" == "1" && -n "${BENCH_TEST_BWRAP:-}" ]]; then
  BWRAP="$BENCH_TEST_BWRAP"
fi

fail() { echo "launch-candidate.sh: $*" >&2; exit 2; }
[[ -x "$BWRAP" ]] || fail "blinded execution requires executable /usr/bin/bwrap"

runtime_mounts() {
  BWRAP_ARGS=(
    --unshare-user --unshare-pid --unshare-ipc --unshare-uts --unshare-cgroup-try
    --die-with-parent --new-session --clearenv
    --proc /proc --dev /dev --tmpfs /tmp --dir /home --dir /home/candidate
    --dir /runtime --dir /runtime/bin
    --setenv HOME /home/candidate --setenv TMPDIR /tmp
    --setenv PATH /runtime/bin:/usr/bin:/bin
  )
  local path
  for path in /usr /bin /lib /lib64; do
    [[ ! -e "$path" ]] || BWRAP_ARGS+=(--ro-bind "$path" "$path")
  done
  for path in /etc/ssl /etc/resolv.conf /etc/hosts /etc/nsswitch.conf /etc/passwd /etc/group; do
    [[ ! -e "$path" ]] || BWRAP_ARGS+=(--ro-bind "$path" "$path")
  done
}

if [[ "${1:-}" == "--probe" ]]; then
  [[ $# -eq 1 ]] || fail "--probe takes no arguments"
  runtime_mounts
  BENCH_CONTROLLER_PROBE=forbidden "$BWRAP" "${BWRAP_ARGS[@]}" -- \
    /bin/sh -c '
      test "${BENCH_CONTROLLER_PROBE+x}" != x
      test ! -e /controller
      test ! -e /workspace
      test ! -e "/proc/$1"
      ! tr "\\000" "\\n" < /proc/1/environ | grep -q BENCH_CONTROLLER_PROBE
    ' candidate-probe "$$"
  exit 0
fi

[[ "${1:-}" == "--run" && $# -eq 8 ]] || {
  fail "usage: launch-candidate.sh --run WORK SESSION CREDENTIALS CONFIG PROMPT TELEMETRY LOGICAL-EXTENSION"
}
shift
WORKDIR="$1"
SESSION_DIR="$2"
CREDENTIAL_DIR="$3"
CONFIG="$4"
PROMPT_FILE="$5"
TELEMETRY_FILE="$6"
EXTENSION_ROOT="$7"

for path in "$WORKDIR" "$SESSION_DIR" "$CREDENTIAL_DIR"; do
  [[ -d "$path" ]] || fail "required candidate directory does not exist: $path"
done
[[ -r "$PROMPT_FILE" ]] || fail "candidate prompt is not readable"
[[ -f "$TELEMETRY_FILE" ]] || fail "private telemetry channel does not exist"

case "$CONFIG" in
  baseline|agentless)
    TREATMENT='{}'
    PI_CONFIG_FLAGS=(--no-skills --no-extensions)
    ;;
  fabric-local)
    TREATMENT='{"prewalk":{"activation":"disabled","model":"openai-codex/gpt-5.6-sol","mode":"in-place"}}'
    PI_CONFIG_FLAGS=(-e /runtime/extension)
    ;;
  fabric-local-disabled)
    TREATMENT='{"prewalk":{"activation":"disabled","model":"openai-codex/gpt-5.6-sol","mode":"in-place"}}'
    PI_CONFIG_FLAGS=(-e /runtime/extension)
    ;;
  fabric-local-gated)
    TREATMENT='{"prewalk":{"activation":"gated","model":"openai-codex/gpt-5.6-sol","mode":"in-place"}}'
    PI_CONFIG_FLAGS=(-e /runtime/extension)
    ;;
  fabric-local-always)
    TREATMENT='{"prewalk":{"activation":"always","model":"openai-codex/gpt-5.6-sol","mode":"in-place"}}'
    PI_CONFIG_FLAGS=(-e /runtime/extension)
    ;;
  fabric-*)
    TREATMENT='{}'
    PI_CONFIG_FLAGS=(-e /runtime/extension)
    ;;
  *) fail "unknown candidate treatment" ;;
esac

PI_COMMAND=$(command -v pi) || fail "pi executable was not found"
PI_REAL=$(readlink -f "$PI_COMMAND") || fail "cannot resolve pi executable"
NODE_COMMAND=$(command -v node) || fail "node executable was not found"
NODE_REAL=$(readlink -f "$NODE_COMMAND") || fail "cannot resolve node executable"
LAUNCHER_DIR="$(cd "$(dirname "$0")" && pwd)"
BOOTSTRAP="$LAUNCHER_DIR/candidate-bootstrap.mjs"
CHANNEL_RELAY="$LAUNCHER_DIR/candidate-channel.py"
INNER_LAUNCHER="$LAUNCHER_DIR/candidate-inner.py"

# Tests may point at a self-contained JavaScript Pi fixture. Real Pi resolves to
# .../<package>/dist/bundle/cli.js, whose complete package is mounted neutrally.
if [[ "${BENCH_TEST_MODE:-}" == "1" && -n "${BENCH_TEST_PI_ROOT:-}" ]]; then
  PI_PACKAGE_ROOT="$BENCH_TEST_PI_ROOT"
  PI_ENTRY="$PI_PACKAGE_ROOT/dist/bundle/cli.js"
else
  case "$PI_REAL" in
    */dist/bundle/cli.js)
      PI_PACKAGE_ROOT=$(cd "$(dirname "$PI_REAL")/../.." && pwd)
      PI_ENTRY="$PI_PACKAGE_ROOT/dist/bundle/cli.js"
      ;;
    *) fail "pi executable is not the expected bundled JavaScript CLI" ;;
  esac
fi
[[ -f "$PI_ENTRY" && -r "$BOOTSTRAP" ]] || fail "candidate runtime is incomplete"

runtime_mounts
BWRAP_ARGS+=(
  --bind "$WORKDIR" /workspace
  --bind "$SESSION_DIR" /session
  --bind "$CREDENTIAL_DIR" /credentials
  --ro-bind "$PROMPT_FILE" /prompt.txt
  --ro-bind "$NODE_REAL" /runtime/bin/node
  --ro-bind "$PI_PACKAGE_ROOT" /runtime/pi
  --ro-bind "$BOOTSTRAP" /runtime/bootstrap.mjs
  --ro-bind "$INNER_LAUNCHER" /runtime/inner.py
  --setenv PI_CODING_AGENT_DIR /credentials
  --chdir /workspace
)

if [[ "${#PI_CONFIG_FLAGS[@]}" -gt 0 && "${PI_CONFIG_FLAGS[0]}" == "-e" ]]; then
  [[ -d "$EXTENSION_ROOT" ]] || fail "candidate extension does not exist"
  BWRAP_ARGS+=(--dir /runtime/extension)
  for path in package.json dist skills node_modules; do
    [[ ! -e "$EXTENSION_ROOT/$path" ]] || BWRAP_ARGS+=(--ro-bind "$EXTENSION_ROOT/$path" "/runtime/extension/$path")
  done
  [[ -f "$EXTENSION_ROOT/package.json" && -d "$EXTENSION_ROOT/dist" ]] \
    || fail "candidate extension must be built before a blinded run"
fi

exec python3 "$CHANNEL_RELAY" "$TELEMETRY_FILE" "$TREATMENT" \
  "$BWRAP" "${BWRAP_ARGS[@]}" -- \
  /usr/bin/python3 /runtime/inner.py \
  /runtime/bin/node --import /runtime/bootstrap.mjs /runtime/pi/dist/bundle/cli.js \
  --print --thinking low --model openai-codex/gpt-5.6-sol \
  --session-dir /session --no-prompt-templates --no-context-files --no-themes \
  "${PI_CONFIG_FLAGS[@]}" "$(<"$PROMPT_FILE")"
