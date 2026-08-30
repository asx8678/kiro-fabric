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
PREWALK_ACTIVATION="disabled"
LOCAL_FABRIC=0
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
    LOCAL_FABRIC=1
    PREWALK_ACTIVATION=${CONFIG#fabric-local-}
    [[ "$CONFIG" == "fabric-local" ]] && PREWALK_ACTIVATION="disabled"
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

BLINDED=0
if [[ -n "${BENCH_ARM:-}${BENCH_PAIR:-}${BENCH_CONTROLLER_DIR:-}" ]]; then
  [[ -n "${BENCH_ARM:-}" && -n "${BENCH_PAIR:-}" && -n "${BENCH_CONTROLLER_DIR:-}" ]] \
    || { echo "blinded cells require BENCH_ARM, BENCH_PAIR, and BENCH_CONTROLLER_DIR" >&2; exit 2; }
  [[ "$BENCH_ARM" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ ]] \
    || { echo "invalid blinded arm id" >&2; exit 2; }
  [[ "$BENCH_PAIR" == "$SLUG/rep$REP" ]] \
    || { echo "blinded pair id does not match cell" >&2; exit 2; }
  [[ -d "$BENCH_CONTROLLER_DIR" ]] \
    || { echo "blinded controller directory does not exist" >&2; exit 2; }
  BLINDED=1
fi

mkdir -p "$CELL/session" "$CELL/logs" "$CELL/artifacts"
WORKDIR="$CELL/workdir"
[[ ! -e "$WORKDIR" ]] || { echo "cell workdir already exists: $WORKDIR" >&2; exit 2; }

RUN_AGENT_DIR="$AGENT_DIR"
RUN_SESSION_DIR="$CELL/session-store"
TREATMENT_RESULT=""
if [[ "$BLINDED" -eq 1 ]]; then
  # Raw sessions and the per-cell Fabric configuration contain treatment
  # labels. Keep both under the private controller tree; the shared agent dir
  # remains treatment-neutral and public sessions are scrubbed below.
  PRIVATE_CELL="$BENCH_CONTROLLER_DIR/cells/$BENCH_ARM/$SLUG/rep$REP"
  RUN_AGENT_DIR="$PRIVATE_CELL/agent"
  RUN_SESSION_DIR="$PRIVATE_CELL/session-store"
  TREATMENT_RESULT="$PRIVATE_CELL/treatment.json"
  (umask 077; mkdir -p "$RUN_AGENT_DIR" "$RUN_SESSION_DIR")
  for name in auth.json settings.json; do
    [[ ! -f "$AGENT_DIR/$name" ]] || cp "$AGENT_DIR/$name" "$RUN_AGENT_DIR/$name"
  done
else
  mkdir -p "$RUN_SESSION_DIR"
fi

if [[ "$LOCAL_FABRIC" -eq 1 ]]; then
  (umask 077; python3 - "$RUN_AGENT_DIR/fabric.json" "$PREWALK_ACTIVATION" <<'PYCONFIG'
import json, sys
json.dump({
    "prewalk": {
        "activation": sys.argv[2],
        "model": "openai-codex/gpt-5.6-sol",
        "mode": "in-place",
    }
}, open(sys.argv[1], "w"), indent=2)
PYCONFIG
  )
fi
COMMON_FLAGS=(--print --thinking low --model openai-codex/gpt-5.6-sol --session-dir "$RUN_SESSION_DIR" --no-prompt-templates --no-context-files --no-themes)

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
    "$RUN_SESSION_DIR" "$CELL/logs" "$CELL/artifacts" "$RUN_AGENT_DIR" "$AGENT_TIMEOUT"; then
    AGENT_EXIT=0
  else
    AGENT_EXIT=$?
  fi
  echo "$AGENT_EXIT" > "$CELL/agent-exit-code.txt"
else
  PI_CODING_AGENT_DIR="$RUN_AGENT_DIR" pi "${COMMON_FLAGS[@]}" "${CFG_FLAGS[@]}" "$PROMPT" \
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

# Session artifacts. Blinded runs retain raw controller-only sessions for
# activation telemetry and publish a copy with treatment-bearing custom data
# removed. Other model/tool records remain byte-for-byte JSON equivalents.
if [[ "$BLINDED" -eq 1 ]]; then
  python3 - "$RUN_SESSION_DIR" "$CELL/session" <<'PYSESSION'
import json, pathlib, sys
source, target = map(pathlib.Path, sys.argv[1:])
target.mkdir(parents=True, exist_ok=True)
decision_type = "kiro-fabric-prewalk-decision"

def custom_type(value):
    if not isinstance(value, dict):
        return None
    if isinstance(value.get("customType"), str):
        return value["customType"]
    message = value.get("message")
    return message.get("customType") if isinstance(message, dict) else None

def scrub(value, prewalk=False):
    if isinstance(value, list):
        return [scrub(item, prewalk) for item in value]
    if not isinstance(value, dict):
        return value
    kind = custom_type(value)
    local_prewalk = prewalk or (isinstance(kind, str) and kind.startswith("kiro-fabric-prewalk-"))
    return {
        key: scrub(item, local_prewalk)
        for key, item in value.items()
        if not (local_prewalk and key == "activation")
    }

for index, path in enumerate(sorted(source.rglob("*.jsonl"))):
    destination = target / f"{index:04d}-{path.name}"
    with path.open(errors="replace") as reader, destination.open("w", encoding="utf-8") as writer:
        for line in reader:
            try:
                record = json.loads(line)
            except json.JSONDecodeError:
                # Pi session files are NDJSON. Refuse to republish malformed raw
                # content rather than copying a treatment string uninspected.
                continue
            if custom_type(record) == decision_type:
                continue
            writer.write(json.dumps(scrub(record), separators=(",", ":")) + "\n")
PYSESSION
  # Pi may refresh OAuth credentials during a serial run. Carry only that
  # neutral credential state forward; never copy per-cell Fabric configuration.
  if [[ -f "$RUN_AGENT_DIR/auth.json" ]]; then
    cp "$RUN_AGENT_DIR/auth.json" "$AGENT_DIR/auth.json"
  fi
else
  find "$RUN_SESSION_DIR" -name '*.jsonl' -exec cp {} "$CELL/session/" \; 2>/dev/null || true
fi

# --- patch artifact ---
git -C "$WORKDIR" add -A >/dev/null 2>&1
git -C "$WORKDIR" diff --cached "$BASE_REF" -- . ':(exclude)vendor/**' ':(exclude)**/node_modules/**' ':(exclude).verify-bin/**' ':(exclude).verify-out/**' > "$CELL/artifacts/model.patch" 2>/dev/null
(git -C "$WORKDIR" ls-files --cached -- 'vendor/*' '*/node_modules/*' | sed -e 's/.*/[vendored dependency paths omitted from patch]/' | head -1 >> "$CELL/artifacts/model.patch" 2>/dev/null) || true

# --- metrics from session jsonl ---
python3 - "$CELL" "$WALL" "$PREWALK_ACTIVATION" "$RUN_SESSION_DIR" \
  "$BLINDED" "$TREATMENT_RESULT" "$CONFIG" <<'PYEOF'
import json, glob, os, sys
(cell, wall_raw, prewalk_activation, session_dir, blinded_raw,
 treatment_result, config) = sys.argv[1:]
wall = float(wall_raw)
blinded = blinded_raw == "1"
arm = os.environ.get("BENCH_ARM", "")  # opaque arm id when blinded
pair = os.environ.get("BENCH_PAIR", "")
turns = 0; tool_calls = 0
tot = {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "totalTokens": 0}
cost_seen = 0.0
prewalk_decisions = 0; prewalk_eligible = 0; prewalk_armed = 0
prewalk_reasons = {}
for f in glob.glob(os.path.join(session_dir, "**", "*.jsonl"), recursive=True):
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
}
telemetry = {
    "prewalk_activation": prewalk_activation,
    "prewalk_gate_decisions": prewalk_decisions,
    "prewalk_gate_eligible": prewalk_eligible,
    "prewalk_automatic_arms": prewalk_armed,
    "prewalk_gate_reasons": dict(sorted(prewalk_reasons.items())),
}
if blinded:
    private = {
        "schema_version": 1,
        "config": config,
        "arm_id": arm,
        "pair_id": pair,
        **telemetry,
    }
    with open(treatment_result, "w") as handle:
        json.dump(private, handle, indent=2)
        handle.write("\n")
    os.chmod(treatment_result, 0o600)
else:
    result.update(telemetry)
with open(os.path.join(cell, "result.json"), "w") as handle:
    json.dump(result, handle, indent=2)
    handle.write("\n")
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

if [[ "$BLINDED" -eq 1 ]]; then
  # Fail closed if a future refactor republishes treatment state. The private
  # controller copy above is the sole deblinding/analyzability surface.
  python3 - "$AGENT_DIR" "$CELL" "$CONFIG" <<'PYLEAK'
import json, pathlib, re, sys
agent, cell, config = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2]), sys.argv[3]
activation = config.removeprefix("fabric-local-") if config.startswith("fabric-local-") else "disabled"
errors = []
if (agent / "fabric.json").exists():
    errors.append("shared agent directory contains fabric.json")
for shared_path in sorted(path for path in agent.rglob("*") if path.is_file()):
    relative = str(shared_path.relative_to(agent))
    text = shared_path.read_text(errors="replace")
    if config in relative or config in text:
        errors.append(f"shared agent directory contains literal config in {relative}")
    if re.search(rf'"activation"\s*:\s*"{re.escape(activation)}"', text):
        errors.append(f"shared agent directory contains literal activation in {relative}")
if (cell / "session-store").exists():
    errors.append("raw session-store was published")

forbidden_result_keys = {
    "prewalk_activation", "prewalk_gate_decisions", "prewalk_gate_eligible",
    "prewalk_automatic_arms", "prewalk_gate_reasons",
}

def visit(value, path=""):
    if isinstance(value, dict):
        for key, item in value.items():
            location = f"{path}.{key}" if path else key
            yield location, key, item
            yield from visit(item, location)
    elif isinstance(value, list):
        for index, item in enumerate(value):
            yield from visit(item, f"{path}[{index}]")

try:
    result = json.loads((cell / "result.json").read_text())
except (OSError, json.JSONDecodeError) as error:
    errors.append(f"cannot inspect public result: {error}")
else:
    for location, key, value in visit(result):
        if key in forbidden_result_keys:
            errors.append(f"public result contains {location}")
        if isinstance(value, str) and value == config:
            errors.append(f"public result contains literal config at {location}")

for session_path in sorted((cell / "session").glob("*.jsonl")):
    for number, line in enumerate(session_path.read_text(errors="replace").splitlines(), 1):
        try:
            record = json.loads(line)
        except json.JSONDecodeError:
            errors.append(f"malformed public session line {session_path.name}:{number}")
            continue
        for location, key, value in visit(record):
            if key == "customType" and value == "kiro-fabric-prewalk-decision":
                errors.append(f"public session contains activation telemetry at {session_path.name}:{number}")
            if key == "activation" and isinstance(value, str) and value in {"always", "gated", "disabled"}:
                errors.append(f"public session contains literal activation at {session_path.name}:{number}:{location}")
            if isinstance(value, str) and value == config:
                errors.append(f"public session contains literal config at {session_path.name}:{number}:{location}")
if errors:
    raise SystemExit("blinded leakage assertion failed: " + "; ".join(errors))
PYLEAK
fi

echo "cell done: $SLUG $CONFIG rep$REP -> $CELL"
cat "$CELL/result.json"
[[ "$VERIFIER_EXIT" -eq 0 ]]
