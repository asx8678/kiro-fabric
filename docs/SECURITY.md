# Security model

Fabric Lite v1 runs trusted local model-generated programs in a disposable Node process. It is **not a sandbox for hostile JavaScript**. Imports and documented Node entry points are rejected, but Node isolation is not claimed.

Host capabilities contain paths under the real project root, reject traversal and symlink escape, deny secrets and common metadata/dependency/build trees, and cap reads. Writes, patching, and shell are disabled by default. Enabling shell requires a project allowlist and still uses bounded streams, filtered environment, contained cwd, timeout, and process-group termination. Kiro workers have no tools. Child AI calls receive a filtered environment; credentials are never inspected, copied, or logged.

Run artifacts contain program source, hashes, sizes, timing, metrics, and final results. Full child prompts/transcripts are not retained. `.fabric-lite/runs/` is ignored. Treat debug mode and run artifacts as potentially source-sensitive.