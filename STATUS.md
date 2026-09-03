# Status

The repository now builds and tests one native `kiro-fabric` custom-agent package. Power manifests, registry mutation, activation, and global steering installation are removed. Core QuickJS, compiler, provider, approval, workspace, persistence, cancellation, tracing, federation, and security behavior is retained.

The model-visible `fabric_workspace` input schema is a non-combinator object (no top-level oneOf/anyOf/allOf). Runtime invocation still validates the strict action union and fails closed on invalid combinations. Authenticated Kiro CLI 2.21.0 previously rejected the then-advertised top-level union before model execution; that shape has been replaced. Global resolution, multi-turn same-PID reuse, roots, elicitation, compaction, shutdown, resume, and durable cross-process restoration still require a green `certify:agent:real` run on the exact release commit. Release stays blocked until that objective real-client evidence is collected on a supported client.
