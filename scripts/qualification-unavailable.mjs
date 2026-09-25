#!/usr/bin/env node
// Fail-closed retirement marker for command names whose implementation was
// removed with the bulk test-suite deletion. A missing suite is NOT success:
// every invocation exits nonzero and names the gap. Replace only with a
// reviewed, implemented verification entrypoint; never print a pass here.
const id = process.argv[2] ?? "unnamed-verification";
const reasons = {
  "test-suite": "the default Vitest suite (tests/**/*.test.ts) was removed",
  "test-fast-suite": "the source-focused Vitest subset was removed",
  "installer-contract-suite": "the installer/runtime contract suite (scripts/test-installer.mjs) was removed",
  "installer-bundle-suite": "the installed-bundle acceptance suite (scripts/test-installer.mjs) was removed",
  "macos-staging-suite": "the macOS staging/install/archive suite was removed",
  "fovea-reference-qualification": "the Fovea reference qualification driver was removed",
  "fovea-external-qualification": "the Fovea external-diagnostics driver was removed",
  "release-grade-suite": "release-grade behavioral verification is not implemented after the test-suite removal"
};
const reason = reasons[id] ?? "the requested verification is not implemented";
process.stderr.write(`UNQUALIFIED: ${id} unavailable \u2014 ${reason}. Fail-closed placeholder, not a pass. Restore reviewed behavioral coverage before qualification.\n`);
process.exitCode = 69;
