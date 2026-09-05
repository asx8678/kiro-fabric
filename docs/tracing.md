# Tracing

Enable private bounded JSONL tracing with `KIRO_FABRIC_DEBUG=1` or the private Agent configuration. Files are under `$KIRO_HOME/kiro-fabric/data/fabric/traces`. `fabric_info` reports the active file.

Routine hooks record lifecycle metadata, identifiers, durations, and character or byte counts—not source, approval arguments, result contents, or free-form exception text. `argsChars`, bridge `resultChars`, projection `visibleChars`, and execution `resultValueChars` are UTF-16 character counts. Projection `visibleBytes` is the UTF-8 byte count. These are operational size measurements, not token, usage, cost, or billing measurements.

`exec.projection` describes what the caller can see: `visibleChars`, `visibleBytes`, `isError`, `overflowed`, and `artifactRetained`. `exec.end.resultValueChars` independently describes the returned execution value; the analyzer retains the pre-projection `exec.end.resultChars` as both `resultChars` and the explicit `legacyResultChars`. Missing or invalid projection metadata is reported as unknown rather than inferred from either result field.

`executionAttempts` counts observed caller requests by unique execution ID across `tool.fabric_exec`, `exec.start`, `exec.end`, and `exec.projection`, without double-counting. `guestExecutionAttempts` separately counts emitted `exec.start` events. `guestStatus` preserves `exec.end.status`; `requestStatus` describes the caller boundary, where projection `isError` overrides guest success (for example, failed artifact retention). Requests without either outcome increment `executionUnknownOutcomes`, not failures. `coverage` is `incomplete-lower-bound` when dropped, truncated, or malformed records are present; totals then describe only observed records.

For spans, `monoUs` is the start timestamp and `durUs` is the duration. The analyzer computes self time by subtracting the union of direct-child intervals clipped to the parent interval, so overlapping or nested children are not double-counted. Missing, non-finite, negative, or overflowing endpoint timing remains unknown and produces an anomaly; aggregates do not silently turn unknown timing into zero. Invalid spans remain visible in JSON with null timing, but are omitted from Chrome Trace output.

Bridge character totals are null when any contributing count is missing, negative, or non-finite; companion known/unknown count fields show coverage. Heap delta/max are likewise null when required snapshots lack valid usage, with known/unknown snapshot counts. A genuine zero remains a known zero.

Failure metadata uses a closed category set such as `approval_failed` and `provider_failed`. Original errors remain available in execution responses, which must be handled as potentially sensitive. No raw-error diagnostic mode is enabled.

The tracer is a low-level event writer, not a general-purpose secret sanitizer. Custom embedders must emit metadata only; identifiers and locally added hooks may themselves be sensitive. Do not log payloads or secrets. Keep trace files private and review them before sharing.
