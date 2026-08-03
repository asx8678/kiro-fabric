# Candidate designs

- **Batch:** deterministic local grouping, then bounded parallel review. Lower call count.
- **Per-file:** one review call per file. Simpler, but duplicates context and findings.

The fixture's expected recommendation is Batch when both produce equivalent evidence.