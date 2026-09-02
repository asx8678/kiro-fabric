# Kiro Fabric Skill and Power Review

This review covers the additive Power skills in `skills/`, the managed Kiro
skill in `strict/skills/`, repository steering, and the checked-in development
agent. Scores describe the remediated state.

## Scorecard

| Dimension | Score | Result |
| --- | ---: | --- |
| Package/spec compliance | 5/5 | Agent Plugins 1.0.0 manifests are validated; additive skills are immediate `skills/*/SKILL.md` children with supported frontmatter. |
| Trigger clarity | 5/5 | `fabric-orchestration` routes multi-step Fabric work; `fabric-exec` routes exact program authoring, debugging, and shape-error recovery. Both exclude ordinary single native operations. |
| Instruction precision | 5/5 | Session setup, capability discovery, approval denial, cancellation, artifact paging, and Power capability boundaries are deterministic and fail closed. |
| Token efficiency | 4/5 | The hot paths are compact. A small amount of safety-boundary repetition remains intentionally because either additive skill may load alone. |
| Progressive disclosure | 5/5 | Exact API, MCP, agent-boundary, and startup troubleshooting detail lives in conditional Power references. Managed guide/review/workflow material is reference-only. |
| MCP/tool workflow | 5/5 | Known actions are called directly; uncertain actions use one search followed by a selected describe. Independent fan-out preserves expected failures as data. |

## Findings corrected

1. The exact-execution skill used a topic description instead of activation
   cues. Its description now names write/debug/recover cases and argument-shape
   errors. The orchestration skill has a separate multi-step trigger and an
   explicit single-native-operation exclusion.
2. Runtime preflight guidance was paid on every skill load. Node and doctor
   steps moved to `skills/fabric-exec/references/troubleshooting.md` and load
   only after an MCP startup failure.
3. Discovery guidance implied three calls for every action. It now calls known
   contracts directly, searches once only when uncertain, describes only the
   selected result, and lists providers only when availability is unknown.
4. The managed profile exposed several nonstandard sibling workflow skills.
   It now ships one standard `fabric-exec` skill with five attested progressive
   references. The generated profile binds only that skill URI.
5. Static repository rules were mixed into model-facing guidance. Technology,
   ownership, Power invariants, strict-skill rules, and API patterns now live
   in `.kiro/steering/`; the generated managed prompt retains only runtime
   behavior needed in every session.
6. A development agent is checked in as `.kiro/agents/kiro-fabric-dev.json`
   so it cannot shadow the installer-owned `kiro-fabric` profile. It binds
   compact steering plus lazy repository skills, disables ambient MCP/Power
   inheritance, and exposes only `@fabric/fabric_exec`. Its launcher derives
   the canonical checkout identity at startup and enables confined `k.bash`, so
   every operation, including a single read and final build, stays in code mode.

## Deliberate duplication

Fail-closed approvals, the absence of `k.*` and `agents.*` in additive mode,
and session-bounded execution stay in each shipped Power skill. End-user Power
installations do not receive this repository's contributor steering, and Kiro
may load either skill independently. Moving those rules only to steering would
save tokens at the cost of an unsafe standalone skill.

## Steering map

| Concern | Steering file | Inclusion |
| --- | --- | --- |
| Pinned build stack and completion gates | `.kiro/steering/tech.md` | `always` |
| Repository ownership map | `.kiro/steering/structure.md` | `auto` with routing description |
| Additive Power packaging and security invariants | `.kiro/steering/fabric-power.md` | `fileMatch` for Power skills, manifests, and Power scripts |
| Managed skill layout and documentation test anchors | `.kiro/steering/strict-skills.md` | `fileMatch: strict/skills/**` |
| Runtime/schema/provider projection rules | `.kiro/steering/api-patterns.md` | `fileMatch` for affected source, tests, skills, and manifests |

The checked-in `.kiro/agents/kiro-fabric-dev.json` binds only compact universal
steering and lazy repository-maintenance skills. Its name intentionally differs
from the installer-owned `kiro-fabric` profile, so repository development
cannot overwrite or shadow an installed managed profile. Both profiles enforce
code mode structurally with a single model-visible `@fabric/fabric_exec` tool;
the additive Power remains the deliberately separate native-compatible mode.

## Verification gates

- `pnpm exec vitest run tests/kiro-steering.test.ts tests/kiro-profile-prompt.test.ts`
- `pnpm exec vitest run --config vitest.process.config.ts tests/kiro-dev-agent-process.test.ts`
- `pnpm exec vitest run tests/skill-docs.test.ts tests/kiro-power-manifest.test.ts`
- `pnpm run power:validate`
- `pnpm run check`
- `pnpm run build` after the final change so `dist/` is fresh
