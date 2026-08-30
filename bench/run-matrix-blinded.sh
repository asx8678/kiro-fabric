#!/usr/bin/env bash
# Blinded paired agent eval for the local bench matrix (V4).
#
# Each (task, rep) runs every config once, in a seed-derived order, under an
# opaque neutral arm directory. Candidate-visible paths and the cell result
# never expose treatment labels (baseline/fabric-local/versions); the
# {config -> arm} mapping is written privately to
#   <results>/controller/arm-map.json  (0600).
#
# Cells are executed in the seeded schedule order (READ order) so both arms
# of a pair use matching state and the order is reproducible from --seed.
#
# Usage:
#   run-matrix-blinded.sh [--run-id ID] [--tasks slug,slug] [--configs a,b] \
#     [--reps N] --seed SEED [--dry-run]
set -euo pipefail
BENCH="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$BENCH/.." && pwd)"
RUN_ID="run-$(date +%Y%m%d-%H%M%S)"
TASKS=""
CONFIGS="baseline,fabric-local"
REPS=1
SEED=""
DRY_RUN=0

die() {
  echo "run-matrix-blinded.sh: $*" >&2
  exit 2
}

require_value() {
  [[ $# -ge 2 && "$2" != --* ]] || die "$1 requires a value"
}

is_safe_name() {
  [[ "$1" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ ]]
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --run-id) require_value "$@"; RUN_ID="$2"; shift 2 ;;
    --tasks) require_value "$@"; TASKS="$2"; shift 2 ;;
    --configs) require_value "$@"; CONFIGS="$2"; shift 2 ;;
    --reps) require_value "$@"; REPS="$2"; shift 2 ;;
    --seed) require_value "$@"; SEED="$2"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    *) die "unknown arg: $1" ;;
  esac
done
[[ -n "$SEED" ]] || die "--seed is required"
is_safe_name "$RUN_ID" || die "invalid --run-id (use 1-128 letters, digits, '.', '_' or '-')"

[[ "$REPS" =~ ^[1-9][0-9]*$ ]] || die "reps must be a positive integer"
if [[ -n "$TASKS" && ( "$TASKS" == ,* || "$TASKS" == *, || "$TASKS" == *,,* ) ]]; then
  die "task and config names must be non-empty portable names"
fi
if [[ "$CONFIGS" == ,* || "$CONFIGS" == *, || "$CONFIGS" == *,,* ]]; then
  die "task and config names must be non-empty portable names"
fi

if [[ -z "$TASKS" ]]; then
  TASK_ARR=()
  for task_dir in "$BENCH"/tasks/*; do
    [[ -d "$task_dir" && -f "$task_dir/task.json" ]] || continue
    TASK_ARR+=("${task_dir##*/}")
  done
  [[ ${#TASK_ARR[@]} -gt 0 ]] || die "no benchmark tasks found"
  TASKS=$(IFS=,; printf '%s' "${TASK_ARR[*]}")
else
  IFS=',' read -r -a TASK_ARR <<< "$TASKS"
fi

# Validate task paths before creating a result directory or reading auth. The
# protocol validator repeats the identifier checks and catches empty trailing
# fields and duplicates before it writes either manifest.
for ((left = 0; left < ${#TASK_ARR[@]}; left++)); do
  task="${TASK_ARR[$left]}"
  is_safe_name "$task" || die "invalid task name: $task"
  [[ -f "$BENCH/tasks/$task/task.json" ]] || die "unknown task: $task"
  [[ -f "$BENCH/tasks/$task/prompt.txt" ]] || die "task is missing prompt.txt: $task"
  for ((right = left + 1; right < ${#TASK_ARR[@]}; right++)); do
    [[ "$task" != "${TASK_ARR[$right]}" ]] || die "duplicate tasks are not allowed"
  done
done

IFS=',' read -r -a CONFIG_ARR <<< "$CONFIGS"
for ((left = 0; left < ${#CONFIG_ARR[@]}; left++)); do
  config="${CONFIG_ARR[$left]}"
  is_safe_name "$config" || die "invalid config name: $config"
  case "$config" in
    baseline|agentless|fabric-local) ;;
    fabric-*)
      [[ -d "$BENCH/vendor/$config/node_modules/kiro-fabric" ]] \
        || die "missing vendored extension for config: $config"
      ;;
    *) die "unknown config: $config" ;;
  esac
  for ((right = left + 1; right < ${#CONFIG_ARR[@]}; right++)); do
    [[ "$config" != "${CONFIG_ARR[$right]}" ]] || die "duplicate configs are not allowed"
  done
done

RESULTS="$BENCH/results/$RUN_ID"
MANIFEST="$RESULTS/manifest.json"
ARM_MAP="$RESULTS/controller/arm-map.json"

if [[ "$DRY_RUN" -eq 1 ]]; then
  # Deterministic, credential-free, zero-side-effect schedule probe. Generate
  # into a private temporary controller directory, never under bench/results;
  # remove it before returning so dry-run cannot leave manifests, auth, reports,
  # or session artifacts behind.
  DRY_PARENT=$(mktemp -d "${TMPDIR:-/tmp}/kiro-fabric-blinded.XXXXXX")
  DRY_ROOT="$DRY_PARENT/$RUN_ID"
  DRY_MANIFEST="$DRY_ROOT/manifest.json"
  cleanup_dry_run() {
    if [[ -n "${DRY_PARENT:-}" && -d "$DRY_PARENT" ]]; then
      rm -rf -- "$DRY_PARENT"
    fi
  }
  trap cleanup_dry_run EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  if ! ARM_PAIRS=$(python3 "$ROOT/scripts/gen-blinded-schedule.py" \
    "$DRY_ROOT" "$DRY_MANIFEST" "$TASKS" "$CONFIGS" "$REPS" "$SEED"); then
    exit 2
  fi
  echo "[dry-run] no credentials read, no cells launched, no network/model activity"
  echo "[dry-run] seeded execution order:"
  while IFS=: read -r record task rep arm extra; do
    [[ "$record" == "ROW" ]] || continue
    [[ -n "$task" && -n "$rep" && -n "$arm" && -z "$extra" ]] \
      || die "malformed schedule output"
    echo "  $task rep$rep -> arm=$arm"
  done <<< "$ARM_PAIRS"
  echo "[dry-run] schedule validated (not persisted): $MANIFEST"
  exit 0
fi

[[ ! -e "$RESULTS" && ! -L "$RESULTS" ]] || die "results directory already exists: $RESULTS"

# Certify the exact local verifier suites before publishing a run directory,
# reading credentials, or making any model call.
MUTATION_REPORT_TMP=$(mktemp "${TMPDIR:-/tmp}/kiro-fabric-verifiers.XXXXXX") || exit 1
cleanup_mutation_report() { rm -f -- "$MUTATION_REPORT_TMP"; }
trap cleanup_mutation_report EXIT
if ! python3 "$BENCH/mutation_verifiers.py" --tasks "$TASKS" --report "$MUTATION_REPORT_TMP"; then
  echo "benchmark aborted: a verifier accepted a mutant or its mutation suite was invalid" >&2
  exit 1
fi

# Generate and validate the schedule before reading credentials. The generator
# stages both manifests and publishes the run directory only after both writes
# succeed.
if ! ARM_PAIRS=$(python3 "$ROOT/scripts/gen-blinded-schedule.py" \
  "$RESULTS" "$MANIFEST" "$TASKS" "$CONFIGS" "$REPS" "$SEED"); then
  exit 2
fi
cp "$MUTATION_REPORT_TMP" "$RESULTS/controller/verifier-mutation-report.json"

AGENT_DIR="$RESULTS/agent"
mkdir -p "$AGENT_DIR"
python3 - "$AGENT_DIR" <<'PYEOF'
import json, os, sys
dst = sys.argv[1]
src = os.path.expanduser("~/.pi/agent/auth.json")
d = json.load(open(src)) if os.path.exists(src) else {}
out = {}
for key in ("openai-codex",):
    if key in d: out[key] = d[key]
json.dump(out, open(os.path.join(dst, "auth.json"), "w"), indent=2)
json.dump({"defaultModel": "gpt-5.6-sol", "defaultProvider": "openai-codex", "defaultThinkingLevel": "low"},
          open(os.path.join(dst, "settings.json"), "w"), indent=2)
print("agent dir prepared")
PYEOF

# Parse and validate the private controller protocol without word-splitting.
# Indexed arrays keep the harness compatible with macOS's system Bash 3.2.
MAP_CONFIGS=()
MAP_ARMS=()
SCHEDULE_ROWS=()
while IFS= read -r line; do
  if [[ "$line" == ROW:* ]]; then
    IFS=: read -r record task rep arm extra <<< "$line"
    [[ "$record" == "ROW" && -n "$task" && "$rep" =~ ^[0-9]+$ && -n "$arm" && -z "$extra" ]] \
      || die "malformed schedule row"
    SCHEDULE_ROWS+=("$task:$rep:$arm")
  else
    IFS=: read -r config arm extra <<< "$line"
    [[ -n "$config" && -n "$arm" && -z "$extra" ]] || die "malformed arm mapping"
    MAP_CONFIGS+=("$config")
    MAP_ARMS+=("$arm")
  fi
done <<< "$ARM_PAIRS"
[[ ${#MAP_ARMS[@]} -eq ${#CONFIG_ARR[@]} ]] || die "incomplete arm mapping"
[[ ${#SCHEDULE_ROWS[@]} -gt 0 ]] || die "empty schedule"

config_for_arm() {
  local needle="$1"
  local index
  for ((index = 0; index < ${#MAP_ARMS[@]}; index++)); do
    if [[ "${MAP_ARMS[$index]}" == "$needle" ]]; then
      printf '%s\n' "${MAP_CONFIGS[$index]}"
      return 0
    fi
  done
  return 1
}

# Execute in seeded schedule order.
RUN_FAILED=0
for row in "${SCHEDULE_ROWS[@]}"; do
  IFS=: read -r tag rep arm <<< "$row"
  if ! cfg=$(config_for_arm "$arm"); then
    echo "CELL FAILED: no config for arm=$arm (pair $tag/rep$rep)" >&2
    RUN_FAILED=1
    continue
  fi
  cell_image="$RESULTS/$arm/$tag/rep$rep"
  echo "=== $tag / rep$rep / arm=$arm ==="
  if ! BENCH_ARM="$arm" BENCH_PAIR="$tag/rep$rep" \
    "$BENCH/run-cell.sh" "$BENCH/tasks/$tag" "$cfg" "$rep" "$cell_image" "$AGENT_DIR"; then
    echo "CELL FAILED: $tag arm=$arm rep$rep" >&2
    RUN_FAILED=1
  fi
done

if [[ "$RUN_FAILED" -ne 0 ]]; then
  echo "blinded run failed: $RESULTS (private mapping: $ARM_MAP)" >&2
  exit 1
fi
echo "blinded run complete: $RESULTS (private mapping: $ARM_MAP)"
