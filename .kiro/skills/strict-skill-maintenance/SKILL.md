---
name: strict-skill-maintenance
description: >-
  Use when changing the installer-owned managed Strict fabric-exec skill,
  progressive references, skill attestation, or managed capability examples.
  Do not use for additive Power skills or ordinary repository work.
---

# Strict skill maintenance

Strict mode remains optional and ships exactly one top-level `fabric-exec`
skill. The installer copies and SHA-256 owns it byte-for-byte. Keep advanced
guide, review, workflow, MCP, and agent material in conditional references;
never recreate overlapping sibling skills or an always-loaded monolith.

Read `references/strict-contract.md` before changing the bundle. Then run
`pnpm exec vitest run tests/skill-docs.test.ts tests/kiro-power-manifest.test.ts`
and rebuild. Never edit generated closure content.
