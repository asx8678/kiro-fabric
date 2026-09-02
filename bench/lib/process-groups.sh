#!/usr/bin/env bash
# Shared bounded process-group ownership for benchmark stages. Callers define
# ACTIVE_STAGE_PID/PGID and ACTIVE_WATCHDOG_PID/PGID, then source this file.

pg_ps_command() {
  if [[ -x /bin/ps ]]; then printf '%s\n' /bin/ps; else command -v ps; fi
}

pg_live_rows() {
  local pgid="$1" ps_command
  ps_command=$(pg_ps_command) || return 2
  "$ps_command" -axo pid=,ppid=,pgid=,state=,command= 2>/dev/null |
    awk -v wanted="$pgid" '
      $3 == wanted {
        state = substr($4, 1, 1)
        if (state != "Z" && state != "X") print
      }
    '
}

pg_group_has_live_members() {
  local rows
  if ! rows=$(pg_live_rows "$1"); then return 2; fi
  [[ -n "$rows" ]]
}

pg_group_diagnostic() {
  local pgid="$1" label="$2" rows
  if rows=$(pg_live_rows "$pgid"); then
    if [[ -n "$rows" ]]; then
      echo "$label process group $pgid did not drain (pid ppid pgid state command):" >&2
      printf '%s\n' "$rows" | head -16 >&2
    fi
  else
    echo "$label process group $pgid could not be inspected" >&2
  fi
}

pg_signal_group() {
  local signal="$1" pgid="$2" rows
  [[ -n "$pgid" ]] || return 0
  if ! rows=$(pg_live_rows "$pgid"); then return 2; fi
  # No live rows means gone (including zombie-only). An observation failure is
  # indeterminate, so do not signal a possibly reused group.
  [[ -z "$rows" ]] && return 0
  kill -"$signal" -- "-$pgid" 2>/dev/null || true
}

pg_wait_for_drain() {
  local pgid="$1" attempts="$2" attempt rows
  for ((attempt = 0; attempt < attempts; attempt++)); do
    if ! rows=$(pg_live_rows "$pgid"); then return 2; fi
    [[ -z "$rows" ]] && return 0
    sleep 0.02
  done
  if ! rows=$(pg_live_rows "$pgid"); then return 2; fi
  [[ -z "$rows" ]] && return 0
  return 1
}

pg_wait_child() {
  local pid="$1"
  [[ -n "$pid" ]] || return 0
  wait "$pid" 2>/dev/null || true
}

pg_terminate_and_drain() {
  local pid="$1" pgid="$2" label="$3" state
  [[ -n "$pid" && -n "$pgid" ]] || return 0
  pg_signal_group TERM "$pgid" || {
    pg_group_diagnostic "$pgid" "$label"
    return 1
  }
  if pg_wait_for_drain "$pgid" 10; then
    pg_wait_child "$pid"
    return 0
  else
    state=$?
  fi
  if [[ "$state" -eq 2 ]]; then
    pg_group_diagnostic "$pgid" "$label"
    return 1
  fi
  pg_signal_group KILL "$pgid" || {
    pg_group_diagnostic "$pgid" "$label"
    return 1
  }
  if pg_wait_for_drain "$pgid" 100; then
    pg_wait_child "$pid"
    return 0
  fi
  pg_group_diagnostic "$pgid" "$label"
  return 1
}

pg_stop_active_process_trees() {
  local failed=0
  # Stop the watchdog first so it cannot race the stage cleanup.
  pg_terminate_and_drain "${ACTIVE_WATCHDOG_PID:-}" "${ACTIVE_WATCHDOG_PGID:-}" benchmark-watchdog || failed=1
  pg_wait_child "${ACTIVE_WATCHDOG_PID:-}"
  pg_terminate_and_drain "${ACTIVE_STAGE_PID:-}" "${ACTIVE_STAGE_PGID:-}" benchmark-stage || failed=1
  pg_wait_child "${ACTIVE_STAGE_PID:-}"
  ACTIVE_WATCHDOG_PID=""
  ACTIVE_WATCHDOG_PGID=""
  ACTIVE_STAGE_PID=""
  ACTIVE_STAGE_PGID=""
  [[ "$failed" -eq 0 ]]
}

pg_start_session() {
  local pid_variable="$1" pgid_variable="$2" stdout_file="$3" stderr_file="$4"
  shift 4
  [[ "${1:-}" == "--" ]] || { echo "pg_start_session requires -- before command" >&2; return 2; }
  shift
  python3 -c 'import os, sys; os.setsid(); os.execvp(sys.argv[1], sys.argv[1:])' \
    "$@" >"$stdout_file" 2>"$stderr_file" &
  local child_pid=$!
  # setsid(2) makes the execed leader its session and process-group leader, so
  # this records PID and PGID before any wait, even if the command exits fast.
  printf -v "$pid_variable" '%s' "$child_pid"
  printf -v "$pgid_variable" '%s' "$child_pid"
}
