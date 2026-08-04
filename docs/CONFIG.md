# Configuration

Fabric Lite is configured by `.fabric-lite/config.json` at the project root. A
missing file falls back to built-in defaults; an invalid file fails with
`CONFIG_ERROR`. Unknown keys and `__proto__`/`constructor`/`prototype` are
rejected, and `permissions.read` is fixed to `allow` while
`permissions.destructive` is fixed to `deny`.

This document covers the operational knobs that are not obvious from the
defaults and that the README does not exhaustively list.

## Retention

`.fabric-lite/runs/` holds per-run artifacts (`program.ts`, `meta.json`,
`calls.jsonl`, `final.json`, and `diagnostics.json`). Artifacts are swept at the
start of every run:

- `retention.runRetentionMs` (default `86400000`, 24h): run directories older
  than this are deleted. `0` keeps runs forever.
- `retention.maxRuns` (default `500`): only the newest N run directories are
  kept regardless of age. `0` disables the count bound.

Because the default is 24h, run records are **not** persistent by default;
raise `runRetentionMs` (or set it to `0`) if you need history for debugging.

## Environment variables

- `KIRO_CLI_PATH` — overrides `runner.executable` (the Kiro CLI binary).
- `FABRIC_LITE_TYPES` — overrides the `types/fabric-lite.d.ts` path used by
  the type-checker (useful for alternative API declarations in tests).
- `FABRIC_LITE_HIGHLIGHT` — `1`/`true`/`yes`/`on` enables syntax highlighting in
  text run output.
- `FABRIC_LITE_RUN_DIR` — set inside the worker; the run artifact directory.
- `FABRIC_LITE_PROMPTER` — `headless` (default) or `interactive`; controls the
  permission prompter used by `ask` policies.

Cloud credentials (`KIRO_API_KEY`, `AWS_*`) are forwarded to the Kiro CLI child
process but are **not** exposed to the guest worker process environment, so a
checked program cannot read them via `process.env`.

## Cache

AI call caching is opt-in (`cache.enabled`, default `false`). When enabled:

- `cache.maxEntries` (default `200`) bounds the number of entries.
- `cache.ttlMs` (default `0`, no expiry) ages entries out by write time.
- Cache keys cover the redacted instruction/context, role, output and timeout
  limits, requested/default model, schema, runner type, and worker agent.
- Hits do not consume AI budgets.
- The runner executable path is included as a cache-key component; note that
  the *path* does not change when the binary is upgraded, so clear the cache
  after rotating Kiro CLI versions.

## Budgets

`budgets.maxAiCalls` (default `100`) is the hard per-execution AI call ceiling.
`budgets.maxRetriesPerCall` (default `1`) currently caps repair attempts at one;
higher values are accepted but behave as `1`. `budgets.maxTotalTokens` (`0` =
off) is a best-effort spent-based guard; the race-free ceiling is the call
count cap. See `fabric-lite docs` for the full budget surface.

## Models

`fabric-lite models` enumerates available models via `kiro-cli chat
--list-models --format json`. `runner.defaultModel` (default `null`) pins the
model used when a program does not specify one.