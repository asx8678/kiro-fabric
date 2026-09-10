# Code Mode: source batches and decisions before tool programs

The new rerun mentioned in the request did not include a transcript. The last supplied agent run remains 5.34 credits / 2m14s, compared in [the previous report](review-iteration-2026-09-10.md). No new agent-quality, credit or elapsed-time comparison is possible from the available evidence.

## Measured retrieval change

The previous build at `644828c7cf51a354bc22dccea136e982718e9948` defaulted `readMany` to 16,000 aggregate JSON characters and capped it at 20,000, while the visible response budget was 50,000. Related source often needed another model/tool exchange even when it could fit in the same visible response.

The candidate defaults to 32,000 and permits an explicit 40,000. The actual Kiro runtime also clamps batches to its nested result limit and 80% of its visible output limit. Other local read/search/shell caps, file/path protections, approvals and continuation hashes are unchanged. Composing multiple responses or logs can still exceed the visible cap, so the guidance asks for smaller budgets when necessary.

Ran the actual previous and candidate built runtimes over four fixed source groups from the review of `pau-security-monitor`, at `ac47b816009541e48bbab437e7645a73b0f977cc`. Every numbered line and file hash was checked against the unchanged source, including continuation boundaries. No source bodies, secrets or network requests are included in the measurement artifact.

| Source group | Previous calls | Candidate calls | Complete evidence identical |
| --- | ---: | ---: | --- |
| README, pipeline, compose and deployment entrypoints | 2 | 1 | Yes |
| Helm values, pod template and config/secret templates | 2 | 1 | Yes |
| Maintenance pipelines and cleanup script | 1 | 1 | Yes |
| Common/staging/prod deployment and CronJob template | 1 | 1 | Yes |
| Total | 6 | 4 | Yes |

This is a **33% reduction in retrieval round trips** for these fixed groups. Total returned compact JSON fell from 66,089 to 65,049 characters through reduced continuation metadata. It is not an agent rerun, a token/cost measurement, or a review-accuracy result. The selection and order of files were fixed by the measurement, not chosen by a model. Small batches already fitting the old cap remain one call.

The [raw measurements](source-batches-2026-09-10.json) include paths, hashes, delivered ranges and per-page sizes. Reproduce each arm with [the read-only probe](source-batch-probe-2026-09-10.mjs), passing that arm's `dist/index.js` and the reviewed checkout. The baseline library was copied before building the candidate; both used the same dependency installation.

## Guidance and actual reasoning effort

The prompt now asks the model to choose the task question, distinguishing evidence and next decision before writing a tool program; read callers, implementation and relevant configuration/tests together; then assess the evidence before selecting a fix. It explicitly distinguishes mechanical dependencies that belong in one execution from interpretation that needs a model decision. It does not add a mandatory planning tool, private-reasoning transcript or simulated thinking delay.

The executable search/read recipe uses one program, merges overlapping windows, returns numbered evidence with hashes, and retains search scope and truncation. Zero-match and partial-search paths remain observable. The standing prompt plus steering stays within its existing 6,400-character budget; the skill stays under 10,400 and review help remains a complete default page.

More relevant context is an input improvement, not a guarantee of deeper reasoning. The installed CLI's `kiro-cli --v3 chat --help` advertises `--effort`; [Kiro documents](https://kiro.dev/docs/cli/reference/slash-commands/#effort) supported per-model effort settings and their higher token use. For a higher-effort session: `kiro-cli --v3 chat --agent kiro-fabric --effort high`. Model/effort must be held equal across future agent comparisons. This change does not override the user's global effort preference or launch paid inference.

## Validation

Targeted tests cover exact large-batch delivery, the unchanged single-read cap, explicit 40,000-character batches, smaller nested/visible limits, hashed continuation, unsafe paths, oversized lines, and the shipped composed search/read recipe. The checked-runtime test delivers the same 27 KB cross-file source in one call instead of two and passes both compact and pretty JSON through the actual visible-response projection without artifact overflow.

The generic Codex skill validator rejects the existing Kiro-specific `compatibility` frontmatter field; it was retained. The repository's own guidance, typechecking and package checks are the applicable validation. The final `pnpm run check` passed: 85 test files, 1,318 passing tests and four skipped tests, plus typechecking, build, dead-code checks, packaged MCP certification and SBOM generation. Initial checks caught a recipe integration test using the old result shape and a missing new-test inventory entry; both were corrected before the successful full run. Sandbox subprocess restrictions required the full check to run outside the sandbox.
