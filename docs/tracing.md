# Tracing

Enable private bounded JSONL tracing with `KIRO_FABRIC_DEBUG=1` or the private Agent configuration. Files are under `$KIRO_HOME/kiro-fabric/data/fabric/traces`. `fabric_info` reports the active file.

Routine hooks record lifecycle metadata, identifiers, durations and payload sizes—not source, approval arguments, result contents or free-form exception text. Failure metadata uses a closed category set: `approval_failed` and `provider_failed`. Original errors remain available in execution responses, which must be handled as potentially sensitive. No raw-error diagnostic mode is enabled.

The tracer is a low-level event writer, not a general-purpose secret sanitizer. Custom embedders must supply metadata-only events; identifiers and locally added hooks may themselves be sensitive. Keep trace files private and review them before sharing.
