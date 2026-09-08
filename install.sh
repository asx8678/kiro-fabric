#!/bin/bash
# Checkout bootstrap. Published installers are generated with exact release pins.
set -eu
umask 077
source_mode=0
json_mode=0
for argument in "$@"; do
  case "$argument" in
    --source) source_mode=$((source_mode + 1));;
    --json) json_mode=1;;
  esac
done
# All error strings here are fixed literals, not executable or remote metadata.
fail() {
  if [ "$json_mode" -eq 1 ]; then
    printf '{"schemaVersion":1,"command":"install","outcome":"%s","error":"%s","exitCode":%s}\n' "$2" "$3" "$1"
  else
    printf 'Kiro Fabric: %s\n' "$3" >&2
  fi
  exit "$1"
}
if [ "$source_mode" -gt 1 ]; then
  fail 2 usage 'Source installation requires exactly one explicit --source.'
fi
if [ "$source_mode" -eq 0 ]; then
  fail 8 discovery-unavailable 'Public distribution is blocked until signed, qualified release-pinned installers exist. For an explicit trusted checkout build, run: bash ./install.sh --source'
fi
base=$(CDPATH= cd -P -- "$(dirname "$0")" && pwd -P)
command -v node >/dev/null 2>&1 || fail 4 prerequisite 'Source mode requires developer Node >=24.'
command -v pnpm >/dev/null 2>&1 || fail 4 prerequisite 'Source mode requires developer pnpm 11.20.0.'
exec node "$base/scripts/source-install.mjs" "$@"
