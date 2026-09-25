# Browser component consistency audit

> **Historical / superseded by Browser Harness removal.** Browser implementation, CLI/provider entry points, bundled skills and execution qualification described below are no longer shipped. This document is retained for provenance (including unrelated verifier/cleanup repair history), not as current setup instructions, available functionality or verification evidence. See [current removal and verification notes](browser-removal.md). Historical paths may no longer exist.


**Scope: metadata/consistency evidence only. This is NOT runtime, containment, or native qualification, and makes no qualification claim.**

## Method (read-only; no writes, network, builds, or pnpm)
Inspected `src/browser/{component.json,upstream.json,component.ts}`, the declared `src/browser/compiler-adapter.ts`, `skills/browser-harness/skill-manifest.json`, the nine skill directories + all `SKILL.md`, vendored copies, and license files. Cross-comparison used plain reads plus `node --input-type=module -e '...'` (existence + `crypto` sha256) and `shasum -a 256`; `grep`/`find`/`git ls-files` (read-only). No files under `docs/browser-evidence/` were created or touched.

## Cross-source identity (5/5 agree)
`integrationRevision` `p1-skill-metadata` (component.json:5, upstream.json:4, component.ts:1), `status` `metadata-qualified-runtime-unqualified` (component.json:6, upstream.json:5, component.ts:2), version `0.13.0` (component.json:4, upstream.json:8), commit `3377f8f495701ce6acf1cc58942ae36b803b0200` (component.json:11, upstream.json:7), repo `https://github.com/monotykamary/browser-harness-js` (component.json:10, upstream.json:6). **0 mismatches.**

## Exact counts observed
- `component.json` `vendoredFiles` (line 13): 14 declared / 14 present / 0 missing.
- `component.json` `adaptedFiles` (line 29): 12 declared / 12 present / 0 missing.
- `upstream.json` `observedPaths` (line 11): 3 declared / 3 present / 0 missing.
- `skill-manifest.json` `skills` (line 12): 9 declared / 9 skill dirs / 9 adapted `SKILL.md` present; 0 missing; ids = cdp, findata, gmaps, gnews, gsearch, rsearch, ttdl, xsearch, ytdl.
- `sourceSha256`: 9 recorded / 9 recomputed match → **0 mismatches**.
- Licenses: exactly 1 license/notice file on disk (`skills/browser-harness/vendored/UPSTREAM-LICENSE.txt`, MIT, Copyright (c) 2026 Browser Use). component.json:8 and skill-manifest.json:9 both reference it and both resolve; the license text references no paths. **0 missing.**

## Mismatch found
1. **Declared `src/browser/compiler-adapter.ts` is absent.** `docs/browser-harness-integration-plan.md:32` declares `src/browser/compiler-adapter.ts` (fails `BROWSER_ADAPTER_NOT_IMPLEMENTED`); generated `closure-manifest.json` artifacts also list it (e.g. `.tmp/.kiro-fabric-agent-generation-*/runtime/closure-manifest.json:359`). No `compiler-adapter*` file exists under `src/`; a repo-wide grep (excluding `node_modules`, `.tmp`, `.git`, `src`/`dist`) finds the name **only** at that doc line, and no `BROWSER_ADAPTER_NOT_IMPLEMENTED` token exists anywhere. **Not fixed:** this names a doc (outside the permitted `skills/browser-harness/`+`src/browser/` metadata) and the `.tmp` closure manifests are generated artifacts, so no minimal unambiguous in-scope metadata fix exists.

## Verdict
All in-scope metadata inventories, hashes, and license references are mutually consistent with disk; the single proven discrepancy is the declared-but-missing `compiler-adapter.ts`. Metadata/consistency evidence only.
