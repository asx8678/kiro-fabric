---
inclusion: fileMatch
fileMatchPattern: "strict/skills/**"
---

# Strict (managed-profile) skill authoring

Strict skills are copied byte-for-byte and SHA-256-owned by the installer
(`src/kiro/skills.ts`); content must be deterministic and portable.

- Exactly one skill ships: `fabric-exec`. Advanced workflows
  (guide/review/workflow) live in `fabric-exec/references/*.md` and are
  loaded progressively — never reintroduce standalone sibling skills.
- Never write absolute paths. Reference sibling files as
  `<skill-dir>/references/<file>.md`; `tests/skill-docs.test.ts` requires at
  least one such reference in `fabric-exec/SKILL.md` and resolves each one.
- Every `π.<key>` used in a ```ts block must be documented as `strings.<key>`
  in the same file. Every ts block is type-checked against
  `KIRO_DECLARATIONS` and must not touch `pi.`, `state.`, `schema.`,
  `mesh.`, `components.`, `compact.`, `extensions.`, or the global `agent()`.
- Pinned phrases tests match verbatim include: "`k` is the built-in",
  "global `agent()` helper are unavailable", "settle: true",
  "1-4 non-empty independent items", "never rerun a successful partition".
  Rephrase around them, but keep the anchors.
- After editing any SKILL.md or reference run
  `pnpm exec vitest run tests/skill-docs.test.ts tests/kiro-power-manifest.test.ts`.
