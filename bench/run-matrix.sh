#!/usr/bin/env bash
# Orchestrate a benchmark run: isolated agent dir, optional vendored old fabric,
# then cells per (task, config, rep). Serial by default to avoid OAuth refresh
# races on the shared codex token.
#
# Usage:
#   run-matrix.sh [--run-id ID] [--tasks slug,slug] [--configs a,b] [--reps N] [--vendor kiro-fabric@0.25.6] [--seed SEED]
set -u
BENCH="$(cd "$(dirname "$0")" && pwd)"
RUN_ID="run-$(date +%Y%m%d-%H%M%S)"
TASKS=""
CONFIGS="baseline,fabric-local"
REPS=1
VENDOR_PKG=""
SEED=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --run-id) RUN_ID="$2"; shift 2 ;;
    --tasks) TASKS="$2"; shift 2 ;;
    --configs) CONFIGS="$2"; shift 2 ;;
    --reps) REPS="$2"; shift 2 ;;
    --vendor) VENDOR_PKG="$2"; shift 2 ;;
    --seed) SEED="$2"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

# --- blinded cell runs (V4): delegate to the opaque-arm paired harness ---
if [[ -n "$SEED" ]]; then
  exec "$BENCH/run-matrix-blinded.sh" --run-id "$RUN_ID" --tasks "$TASKS" --configs "$CONFIGS" --reps "$REPS" --seed "$SEED"
fi

# --- task list and non-model verifier mutation gate ---
if [[ -z "$TASKS" ]]; then
  TASKS=$(find "$BENCH/tasks" -mindepth 1 -maxdepth 1 -type d -exec basename {} \; | sort | paste -sd, -)
fi
MUTATION_REPORT_TMP=$(mktemp "${TMPDIR:-/tmp}/kiro-fabric-verifiers.XXXXXX") || exit 1
cleanup_mutation_report() { rm -f -- "$MUTATION_REPORT_TMP"; }
trap cleanup_mutation_report EXIT
if ! python3 "$BENCH/mutation_verifiers.py" --tasks "$TASKS" --report "$MUTATION_REPORT_TMP"; then
  echo "benchmark aborted: a verifier accepted a mutant or its mutation suite was invalid" >&2
  exit 1
fi

# --- vendored config (e.g. kiro-fabric@0.25.6 = the version from the DeepSWE issue) ---
if [[ -n "$VENDOR_PKG" ]]; then
  NAME="fabric-${VENDOR_PKG#*@}"
  DEST="$BENCH/vendor/$NAME"
  if [[ ! -d "$DEST/node_modules/kiro-fabric" ]]; then
    mkdir -p "$DEST"
    (cd "$DEST" && npm init -y >/dev/null 2>&1 && npm install --legacy-peer-deps --no-audit --no-fund "$VENDOR_PKG" >/dev/null 2>&1)
  fi
  echo "vendored $VENDOR_PKG at $DEST/node_modules/kiro-fabric"
fi

# --- isolated agent dir: copy ONLY the openai-codex auth entry ---
AGENT_DIR="$BENCH/results/$RUN_ID/agent"
mkdir -p "$AGENT_DIR"
cp "$MUTATION_REPORT_TMP" "$BENCH/results/$RUN_ID/verifier-mutation-report.json"
python3 - "$AGENT_DIR" <<'PYEOF'
import json, os, sys
dst = sys.argv[1]
src = os.path.expanduser("~/.pi/agent/auth.json")
d = json.load(open(src)) if os.path.exists(src) else {}
out = {}
for key in ("openai-codex",):
    if key in d:
        out[key] = d[key]
json.dump(out, open(os.path.join(dst, "auth.json"), "w"), indent=2)
json.dump({"defaultModel": "gpt-5.6-sol", "defaultProvider": "openai-codex",
           "defaultThinkingLevel": "low"},
          open(os.path.join(dst, "settings.json"), "w"), indent=2)
print("agent dir prepared with providers:", list(out))
PYEOF

MANIFEST="$BENCH/results/$RUN_ID/manifest.json"
echo "{\"run_id\": \"$RUN_ID\", \"tasks\": \"$TASKS\", \"configs\": \"$CONFIGS\", \"reps\": $REPS}" > "$MANIFEST"

IFS=',' read -ra TASK_ARR <<< "$TASKS"
IFS=',' read -ra CFG_ARR <<< "$CONFIGS"
for slug in "${TASK_ARR[@]}"; do
  for cfg in "${CFG_ARR[@]}"; do
    for ((rep = 0; rep < REPS; rep++)); do
      CELL="$BENCH/results/$RUN_ID/$cfg/$slug/rep$rep"
      echo "=== cell $slug / $cfg / rep$rep ==="
      "$BENCH/run-cell.sh" "$BENCH/tasks/$slug" "$cfg" "$rep" "$CELL" "$AGENT_DIR" \
        || echo "CELL FAILED: $slug $cfg rep$rep"
    done
  done
done

python3 "$BENCH/analyze.py" "$BENCH/results/$RUN_ID"
echo "run complete: $BENCH/results/$RUN_ID"
