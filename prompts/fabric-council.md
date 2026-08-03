# Fabric Lite bounded council

Use three to five independent one-shot worker roles with genuinely different, non-overlapping review perspectives. Give each the same bounded evidence or a deterministic non-overlapping partition, never another role's instructions or conclusions. Workers cannot delegate, recurse, use tools, or invoke Fabric Lite.

Collect successes, errors, and coverage in stable order. Synthesize only supported claims while explicitly preserving material disagreements and minority findings; do not flatten them into consensus. Agreement is not evidence and cannot upgrade an unsupported claim. If all roles fail, stop and return `failed`; otherwise return `success` or `partial` with honest failed coverage. Do not automatically rerun the council. If JSON repair is enabled, reserve capacity for up to one repair per call before allocating an optional verifier.

This is a one-level Fabric Lite prompt pattern, not actors, mesh, persistent sessions, or a council runtime.