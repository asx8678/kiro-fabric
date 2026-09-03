# Status

The repository now builds and tests one native `kiro-fabric` custom-agent package. Power manifests, registry mutation, activation, and global steering installation are removed. Core QuickJS, compiler, provider, approval, workspace, persistence, cancellation, tracing, federation, and security behavior is retained.

Authenticated Kiro CLI 2.21.0 proved profile discovery, selection, native tool visibility, and automatic MCP startup. The run then failed because that client rejects the preserved top-level union schema of `fabric_workspace`; roots, elicitation, persistence-across-real-sessions, and shutdown evidence therefore remain unqualified. Release must remain blocked until a supported client accepts the exact schema or an explicitly versioned contract decision is made.
