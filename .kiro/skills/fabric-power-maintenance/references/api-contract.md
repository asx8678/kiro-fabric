# Power API and skill contract

Change the canonical input schema before adapters or prose, then keep runtime
validation, guest declarations, provider descriptors, model-facing schemas,
examples, and tests synchronized.

Power examples may use mounted provider namespaces and generic
`tools.providers/catalog/search/describe/list/call`; they must not use `k.*`,
`agents.*`, `pi.*`, `tools.fs.*`, or `tools.shell.*`. Call known actions
directly; discover only when the contract is unknown. Await every promised API,
parallelize only independent effects, preserve expected per-item failures as
data, and keep output bounded.

Portable skill frontmatter requires a directory-matching kebab-case `name` and
a precise `description` with both a positive “Use when” condition and a real
exclusion. Keep skills at `skills/*/SKILL.md`, put details in references, verify
every referenced file, and reject duplicate or dangerously overlapping
activation descriptions.
