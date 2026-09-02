# Execution tracing

Optional, toggleable tracing for analyzing TypeScript Code Mode and QuickJS execution flow. Off by default; when off, every hook is one `tracer.enabled` boolean branch with no allocation (arguments are never constructed).

## Enabling

- Environment: `KIRO_FABRIC_DEBUG=1` forces on; `0`/`false`/`no` forces off. The environment overrides configuration. Unrecognized values defer to configuration.
- Configuration: `"tracing": { "enabled": true }` in `${PLUGIN_DATA}/fabric/config/config.json`.
- A malformed configuration or an uncreatable trace file falls back to the disabled tracer; tracing can never break Power startup.

Output: `${PLUGIN_DATA}/fabric/traces/fabric-<pid>-<time36>.jsonl`, created private (`0700` directory, `0600` file, exclusive create). At startup the directory is swept: at most the 16 newest trace files are retained and anything older than 7 days is removed (regular files only; symlinks and foreign entries are never touched).

`fabric_info` reports `tracing: { enabled, file }` so the current trace file is discoverable without guessing `PLUGIN_DATA` internals.

## Format

One JSON object per line (JSONL):

```json
{"v":1,"ts":"2025-01-01T00:00:00.000Z","monoUs":123456789,"seq":7,"cat":"bridge","ev":"fabric.call","execId":"exec_<uuid>","spanId":"span_4","parentId":"span_2","durUs":412000,"data":{"actionRef":"memory.set","argsChars":120,"resultChars":64,"ok":true}}
```

- `monoUs`: monotonic microseconds (`process.hrtime.bigint()`), safe for span arithmetic.
- `seq`: per-process emission order; authoritative when `monoUs` ties.
- `cat`: `init` | `eval` | `bridge` | `teardown`.
- `execId`: one UUID per `fabric_exec` invocation, correlating every span of that execution.
- `spanId` / `parentId`: spans form a deterministic tree per execution — sandbox spans parent to `execute`, bridge spans to `execute`, approval spans to their bridge span. Concurrent bridge calls attribute unambiguously.
- `durUs`: span duration in microseconds (absent on point events).
- `data`: bounded per event (≤ 6,000 serialized chars; payload failures degrade to `{"traceDataError":true}`). Never contains action arguments — approval spans carry `ref`/`risk` only.

## Event taxonomy

| Category | Event | Emitter |
| --- | --- | --- |
| init | `power.start` | MCP server boot (product, version, pid, trace file) |
| init | `quickjs.module.acquire` | WASM module load (`cached` flag distinguishes first load) |
| init | `quickjs.context.create` | Per-execution context/runtime instantiation, with memory and stack limits |
| eval | `tool.fabric_exec` | MCP request receipt |
| eval | `exec.start` / `exec.end` | Service entry/exit (source bytes, payload count, status, elapsed, `resultChars`, `typeErrors`); `exec.end` is emitted on every path including compile failure, and flushes the writer |
| eval | `compile` | Isolated TypeScript compiler worker span (`errors` count) |
| eval | `execute` | Full QuickJS execution span (`termination`, `effectiveTimeoutMs`) |
| eval | `approval.wait` | User elicitation wait per action (`ref`, `risk`, `approved`) — frequently the dominant latency in `mcp.$call` flows |
| eval | `quickjs.eval.setup` / `quickjs.eval.guest` | Sandbox bootstrap eval and guest bundle eval |
| eval | `quickjs.run` | Guest main resolution (async settle) |
| eval | `quickjs.memory` | Numeric VM heap snapshot (`runtime.computeMemoryUsage()`: `memory_used_size`, `malloc_size`, object/atom counts, …) plus host `hostRssBytes`, taken before teardown |
| bridge | `<ref>` (e.g. `memory.get`, `fabric.call`) | One span per host-bridge call with `argsChars`/`resultChars` payload sizes; `data.actionRef` unwraps `tools.call` to the resolved provider ref; failures carry a bounded `error` |
| teardown | `quickjs.teardown` | Context disposal and bridge-task drain |
| teardown | `trace.dropped` / `trace.truncated` | Ring overflow count / file-cap marker |

## Analysis

`scripts/analyze-trace.mjs` turns a trace file into a model-consumable report:

```sh
node scripts/analyze-trace.mjs "$KIRO_FABRIC_TRACE"            # text report
node scripts/analyze-trace.mjs "$KIRO_FABRIC_TRACE" --json     # machine-readable
node scripts/analyze-trace.mjs "$KIRO_FABRIC_TRACE" --chrome out.json  # Chrome Trace / Perfetto
```

The report contains: per-`execId` span trees with self time (parent links, not timestamp guessing), a bridge table keyed by resolved ref (count, total, p95, max, aggregate `argsChars`/`resultChars`, errors), the QuickJS heap trend across executions, and anomalies (ring drops, file truncation, failed executions, bridge errors, denied approvals). Malformed lines are counted, never fatal.

## Writer design

`src/trace/trace-writer.ts`: append-mode ring buffer (default 4,096 lines / 4 MiB, oldest dropped with a counter) flushed on a 250 ms unref'd interval, at each `exec.end`, on explicit `flush()`, on tracer close, and on process `exit` via synchronous `writeSync`+`fsyncSync`. Hard file cap (default 64 MiB) emits a `trace.truncated` marker and disables the writer. Per-line cap 8 KiB. All I/O errors disable the writer rather than propagating.

Ring drops and file truncation are observable inside the trace itself (`trace.dropped`/`trace.truncated`), so silent log loss cannot masquerade as a quiet execution.

## Zero-overhead contract

When disabled, `DISABLED_TRACER` (a frozen singleton) is installed. Call sites guard with `if (tracer.enabled)` before constructing span arguments, so the disabled path allocates nothing and never touches the trace module (the writer is only imported through `createFabricTracer`, which is only called after the toggle resolves on).

## Verification

- `tests/tracing.test.ts` covers: env/config toggle resolution, disabled-tracer no-allocation identity (`span()` returns the same frozen object), writer JSONL round-trip, ring drop counting, file-cap truncation marker, line truncation, span/event field shape (`seq`, `spanId`, `parentId`), cyclic-data fallback, the full QuickJS lifecycle event set with a single `execId`, parent-linked bridge/approval spans with payload sizes, and `exec.end` on compile failure.
- `tests/trace-analyze.test.ts` covers the analyzer: span-tree reconstruction, bridge table unwrap of `tools.call`, numeric heap trend, malformed-line tolerance, anomaly detection, and Chrome Trace export.

## Development and benchmarking workflow

Tracing toggles per process, so development and benchmarking never require code changes:

- Develop with traces on: `KIRO_FABRIC_DEBUG=1 kiro-cli --v3` — find the active file via `fabric_info` (`tracing.file`) and inspect with `node scripts/analyze-trace.mjs <file>`.
- Force off regardless of config: `KIRO_FABRIC_DEBUG=0`.
- A/B benchmarks: run the same workload twice, once with `KIRO_FABRIC_DEBUG=0` (or no variable and default config) and once with `=1`. The disabled build is the pre-tracing cost model: one boolean branch per hook, no allocation, and the trace module is not even loaded.

1. **Accuracy**: run a known workload (e.g. one `fabric_exec` performing two `memory` calls) and assert the span tree via parent links: `execute` → {`quickjs.run`, `bridge.memory.get` ×2} and `seq` strictly increases. `scripts/analyze-trace.mjs --json` makes this a one-liner.
2. **Disabled overhead**: A/B one hundred no-op executions with tracing off vs. the pre-tracing build (or against `KIRO_FABRIC_DEBUG=0`); expected delta is sub-1% (one boolean branch per hook). A quick probe:

   ```sh
   hyperfine -w 20 -r 100 \
     'node driver.js' \
     --env KIRO_FABRIC_DEBUG=0
   ```

   or wrap `performance.now()` around `service.execute` in a loop and compare means with/without the `tracer` option omitted.
3. **Enabled overhead**: compare `KIRO_FABRIC_DEBUG=1` vs off. Expected cost: two `hrtime.bigint()` calls plus bounded JSON serialization per span (µs-scale each; bridge spans additionally serialize args/result for byte attribution); writer I/O is batched off the hot path, so benchmark timing is skewed only by span construction, not disk.
4. **No log loss**: kill the MCP process (`SIGKILL`) mid-execution and confirm the last flushed prefix plus a `trace.dropped` marker bound the loss to ≤ one flush interval; `exec.end` flushes make completed runs fully durable even under a later crash.
