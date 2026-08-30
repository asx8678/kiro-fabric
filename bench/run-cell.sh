#!/usr/bin/env bash
# Run one benchmark cell: fresh checkout of the task's base ref, one agent run,
# verifier, metric extraction. Mirrors the cell layout of
# github.com/Whamp/kiro-fabric-deepswe-trajectories so the same analysis applies.
#
# Usage: run-cell.sh <task-dir> <config> <rep> <cell-out-dir> <agent-dir>
#   config: baseline | agentless | fabric-local | fabric-local-{always,gated,disabled} | fabric-0.25.6
#   agent-dir: isolated PI_CODING_AGENT_DIR (auth + settings) prepared by run-matrix.sh
set -euo pipefail

[[ $# -eq 5 ]] || {
  echo "usage: run-cell.sh <task-dir> <config> <rep> <cell-out-dir> <agent-dir>" >&2
  exit 2
}
TASK_DIR="$1"
CONFIG="$2"
REP="$3"
CELL="$4"
AGENT_DIR="$5"

BENCH="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$BENCH/.." && pwd)"
TASK="$TASK_DIR/task.json"
PROMPT_FILE="$TASK_DIR/prompt.txt"
VERIFY_SCRIPT="$TASK_DIR/verify.sh"

# Validate every local input before checkout setup and, critically, before a Pi
# process can make a model call. Expected agent/verifier nonzero exits are
# captured explicitly below rather than weakening fail-fast setup semantics.
TASK_VALUES=$(python3 - "$TASK" <<'PYTASK'
import json, pathlib, re, sys
path = pathlib.Path(sys.argv[1])
try:
    value = json.loads(path.read_text())
except (OSError, json.JSONDecodeError) as error:
    raise SystemExit(f"invalid task configuration: {error}")
required = ("slug", "repo", "base_ref", "agent_timeout_s", "verify_timeout_s")
if not isinstance(value, dict) or any(name not in value for name in required):
    raise SystemExit("invalid task configuration: missing required fields")
slug, repo, base_ref = (value[name] for name in required[:3])
agent_timeout, verify_timeout = (value[name] for name in required[3:])
if not isinstance(slug, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}", slug):
    raise SystemExit("invalid task configuration: invalid slug")
if not all(isinstance(item, str) and item and "\t" not in item and "\n" not in item for item in (repo, base_ref)):
    raise SystemExit("invalid task configuration: invalid repo/base_ref")
if any(isinstance(item, bool) or not isinstance(item, int) or item < 1 for item in (agent_timeout, verify_timeout)):
    raise SystemExit("invalid task configuration: timeouts must be positive integers")
print("\t".join((slug, repo, base_ref, str(agent_timeout), str(verify_timeout))))
PYTASK
) || exit 2
IFS=$'\t' read -r SLUG REPO_URL BASE_REF AGENT_TIMEOUT VERIFY_TIMEOUT <<< "$TASK_VALUES"
[[ -r "$PROMPT_FILE" ]] || { echo "task is missing readable prompt: $PROMPT_FILE" >&2; exit 2; }
[[ -x "$VERIFY_SCRIPT" ]] || { echo "task requires executable verifier: $VERIFY_SCRIPT" >&2; exit 2; }
[[ -d "$AGENT_DIR" ]] || { echo "agent directory does not exist: $AGENT_DIR" >&2; exit 2; }
[[ "$REP" =~ ^[0-9]+$ ]] || { echo "rep must be a non-negative integer" >&2; exit 2; }

# --- config flags (also validated before any model call) ---
COMMON_FLAGS=(--print --thinking low --model openai-codex/gpt-5.6-sol --session-dir "$CELL/session-store" --no-prompt-templates --no-context-files --no-themes)
PREWALK_ACTIVATION="disabled"
case "$CONFIG" in
  baseline)
    CFG_FLAGS=(--no-skills --no-extensions)
    ;;
  agentless)
    # run-agentless.sh owns the two stock-Pi calls and their fixed bounds.
    CFG_FLAGS=()
    ;;
  fabric-local|fabric-local-always|fabric-local-gated|fabric-local-disabled)
    CFG_FLAGS=(-e "$REPO_ROOT")
    PREWALK_ACTIVATION=${CONFIG#fabric-local-}
    [[ "$CONFIG" == "fabric-local" ]] && PREWALK_ACTIVATION="disabled"
    python3 - "$AGENT_DIR/fabric.json" "$PREWALK_ACTIVATION" <<'PYCONFIG'
import json, sys
json.dump({
    "prewalk": {
        "activation": sys.argv[2],
        "model": "openai-codex/gpt-5.6-sol",
        "mode": "in-place",
    }
}, open(sys.argv[1], "w"), indent=2)
PYCONFIG
    ;;
  fabric-*)
    VENDOR="$BENCH/vendor/$CONFIG/node_modules/kiro-fabric"
    if [[ ! -d "$VENDOR" ]]; then
      echo "missing vendored extension: $VENDOR (see bench/run-matrix.sh vendor step)" >&2
      exit 2
    fi
    CFG_FLAGS=(-e "$VENDOR")
    ;;
  *) echo "unknown config: $CONFIG" >&2; exit 2 ;;
esac

mkdir -p "$CELL/session-store" "$CELL/session" "$CELL/logs" "$CELL/artifacts"
WORKDIR="$CELL/workdir"
[[ ! -e "$WORKDIR" ]] || { echo "cell workdir already exists: $WORKDIR" >&2; exit 2; }

# --- fresh checkout at base ref ---
CACHE="$BENCH/.cache/$(basename "$REPO_URL" .git)"
if [[ ! -d "$CACHE/.git" ]]; then
  git clone "$REPO_URL" "$CACHE" >/dev/null 2>&1
fi
# A disconnected cache is usable at its already-certified base ref.
if ! git -C "$CACHE" fetch --quiet origin >/dev/null 2>&1; then
  echo "warning: cache fetch failed; using existing cache" >&2
fi
git clone --quiet "$CACHE" "$WORKDIR"
# pin the task's base state: local main/master == base ref so agents that
# "branch from main" (per DeepSWE prompts) start from the right tree
if ! git -C "$WORKDIR" branch -f master "$BASE_REF" 2>/dev/null; then :; fi
if ! git -C "$WORKDIR" branch -f main "$BASE_REF" 2>/dev/null; then :; fi
git -C "$WORKDIR" checkout --quiet "$BASE_REF"

# --- agent run with watchdog timeout (macOS lacks GNU timeout) ---
cd "$WORKDIR"
START=$(python3 -c 'import time;print(time.time())')
PROMPT="$(<"$PROMPT_FILE")"
if [[ "$CONFIG" == "agentless" ]]; then
  if "$BENCH/run-agentless.sh" "$WORKDIR" "$PROMPT_FILE" \
    "$CELL/session-store" "$CELL/logs" "$CELL/artifacts" "$AGENT_DIR" "$AGENT_TIMEOUT"; then
    AGENT_EXIT=0
  else
    AGENT_EXIT=$?
  fi
  echo "$AGENT_EXIT" > "$CELL/agent-exit-code.txt"
else
  PI_CODING_AGENT_DIR="$AGENT_DIR" pi "${COMMON_FLAGS[@]}" "${CFG_FLAGS[@]}" "$PROMPT" \
    >"$CELL/logs/pi.stdout.txt" 2>"$CELL/logs/pi.stderr.txt" &
  AGENT_PID=$!
  python3 -c 'import os, signal, sys, time
pid, timeout, grace = int(sys.argv[1]), int(sys.argv[2]), int(sys.argv[3])
time.sleep(timeout)
try: os.kill(pid, signal.SIGTERM)
except ProcessLookupError: raise SystemExit(0)
time.sleep(grace)
try: os.kill(pid, signal.SIGKILL)
except ProcessLookupError: pass' "$AGENT_PID" "$AGENT_TIMEOUT" 20 &
  WATCHDOG=$!
  if wait "$AGENT_PID"; then AGENT_EXIT=0; else AGENT_EXIT=$?; fi
  kill "$WATCHDOG" 2>/dev/null || true
  wait "$WATCHDOG" 2>/dev/null || true
  echo "$AGENT_EXIT" > "$CELL/agent-exit-code.txt"
fi
END=$(python3 -c 'import time;print(time.time())')
WALL=$(python3 -c "print(round($END - $START, 1))")

# session artifacts
find "$CELL/session-store" -name '*.jsonl' -exec cp {} "$CELL/session/" \; 2>/dev/null || true

# --- patch artifact ---
git -C "$WORKDIR" add -A >/dev/null 2>&1
git -C "$WORKDIR" diff --cached "$BASE_REF" -- . ':(exclude)vendor/**' ':(exclude)**/node_modules/**' ':(exclude).verify-bin/**' ':(exclude).verify-out/**' > "$CELL/artifacts/model.patch" 2>/dev/null
(git -C "$WORKDIR" ls-files --cached -- 'vendor/*' '*/node_modules/*' | sed -e 's/.*/[vendored dependency paths omitted from patch]/' | head -1 >> "$CELL/artifacts/model.patch" 2>/dev/null) || true

# --- metrics from session jsonl ---
python3 - "$CELL" "$WALL" "$PREWALK_ACTIVATION" <<'PYEOF'
import json, glob, os, sys
cell, wall, prewalk_activation = sys.argv[1], float(sys.argv[2]), sys.argv[3]
arm = os.environ.get("BENCH_ARM", "")  # opaque arm id when blinded
pair = os.environ.get("BENCH_PAIR", "")
turns = 0; tool_calls = 0
tot = {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "totalTokens": 0}
cost_seen = 0.0
prewalk_decisions = 0; prewalk_eligible = 0; prewalk_armed = 0
prewalk_reasons = {}
for f in glob.glob(os.path.join(cell, "session", "*.jsonl")):
    for line in open(f, errors="replace"):
        try:
            rec = json.loads(line)
        except json.JSONDecodeError:
            continue
        if rec.get("type") == "custom" and rec.get("customType") == "kiro-fabric-prewalk-decision":
            data = rec.get("data") or {}
            prewalk_decisions += 1
            prewalk_eligible += int(data.get("eligible") is True)
            prewalk_armed += int(data.get("armed") is True)
            reason = str(data.get("reason") or "unknown")
            prewalk_reasons[reason] = prewalk_reasons.get(reason, 0) + 1
        msg = rec.get("message", {})
        if msg.get("role") != "assistant":
            continue
        turns += 1
        u = msg.get("usage") or {}
        for k in tot:
            tot[k] += int(u.get(k) or 0)
        c = (u.get("cost") or {}).get("total")
        if c: cost_seen += float(c)
        for item in msg.get("content", []):
            if isinstance(item, dict) and item.get("type") == "toolCall":
                tool_calls += 1
# GPT-5.6 Sol recorded rates (from the trajectories issue): $5/M fresh input,
# $0.50/M cached input, $30/M output. Cached = cacheRead; cacheWrite billed fresh.
RATES = {"input": 5.0, "cached": 0.50, "output": 30.0}
fresh = tot["input"] + tot["cacheWrite"]
cost = (fresh * RATES["input"] + tot["cacheRead"] * RATES["cached"] + tot["output"] * RATES["output"]) / 1e6
patch_path = os.path.join(cell, "artifacts", "model.patch")
patch_bytes = os.path.getsize(patch_path) if os.path.exists(patch_path) else 0
result = {
    "model": "openai-codex/gpt-5.6-sol",
    "thinking_level": "low",
    "arm_id": arm,
    "pair_id": pair,
    "combined_total_tokens": tot["totalTokens"],
    "tokens_fresh_input": fresh,
    "tokens_cached_input": tot["cacheRead"],
    "tokens_output": tot["output"],
    "combined_cost_usd": round(cost, 4),
    "cost_usd_reported": round(cost_seen, 4),
    "agent_wall_s": wall,
    "turns": turns,
    "tool_calls": tool_calls,
    "patch_bytes": patch_bytes,
    "prewalk_activation": prewalk_activation,
    "prewalk_gate_decisions": prewalk_decisions,
    "prewalk_gate_eligible": prewalk_eligible,
    "prewalk_automatic_arms": prewalk_armed,
    "prewalk_gate_reasons": dict(sorted(prewalk_reasons.items())),
}
json.dump(result, open(os.path.join(cell, "result.json"), "w"), indent=2)
PYEOF

# --- verifier ---
VERIFIER_EXIT=0
(
  cd "$WORKDIR"
  "$VERIFY_SCRIPT" "$WORKDIR" "$CELL/result.json" >"$CELL/logs/verify.stdout.txt" 2>"$CELL/logs/verify.stderr.txt" &
  VPID=$!
  python3 -c 'import os, signal, sys, time
pid, timeout, grace = int(sys.argv[1]), int(sys.argv[2]), int(sys.argv[3])
time.sleep(timeout)
try: os.kill(pid, signal.SIGTERM)
except ProcessLookupError: raise SystemExit(0)
time.sleep(grace)
try: os.kill(pid, signal.SIGKILL)
except ProcessLookupError: pass' "$VPID" "$VERIFY_TIMEOUT" 10 &
  WD=$!
  if wait "$VPID"; then status=0; else status=$?; fi
  kill "$WD" 2>/dev/null || true
  wait "$WD" 2>/dev/null || true
  exit "$status"
) || VERIFIER_EXIT=$?
echo "$VERIFIER_EXIT" > "$CELL/verifier-exit-code.txt"
if [[ "$VERIFIER_EXIT" -ne 0 ]]; then
  echo "verifier infrastructure failed for $SLUG (exit $VERIFIER_EXIT)" >&2
fi
echo "cell done: $SLUG $CONFIG rep$REP -> $CELL"
cat "$CELL/result.json"
[[ "$VERIFIER_EXIT" -eq 0 ]]
