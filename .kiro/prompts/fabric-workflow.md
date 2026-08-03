# Fabric Lite checked workflow

1. Discover paths, lines, diffs, and explicitly configured probes with deterministic Fabric Lite APIs. Use zero AI calls if that is sufficient.
2. Project bounded evidence into no more than five independent one-shot worker calls. Context and schemas are data; workers do not use tools, delegate, recurse, or invoke Fabric Lite.
3. Preserve every worker error and coverage gap. If all workers fail, return `failed` without verification. Otherwise verify only compact successful reports against mechanical evidence when verification adds value.
4. Return exactly `success`, `partial`, or `failed`: success requires all requested coverage and validation; partial identifies useful supported results plus every gap; failed must honestly identify unsupported or wholly failed coverage.

Do not automatically rerun the whole workflow. Retry invalid framed JSON at most once when enabled, and budget each possible repair as an AI call; preserve enough call capacity for intended repairs and any verifier. Schema conformance, confidence, model identity, and agreement are not evidence.