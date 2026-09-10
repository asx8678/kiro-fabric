# Review improvements after the updated Kiro run

The supplied rerun improved coverage and corrected its Bash diagnosis, but still missed misleading dry-run logs and a suspicious protected-object guard in code it read. It retained unsupported claims about external variables and validator failure policy. This change addresses execution mechanics and the review procedure; it does not certify model superiority.

## Implemented behavior

- `local.readMany({windows,maxChars?})` delivers numbered source, hashes, total lines and bounded continuations. It preserves every undelivered requested range in `remaining`, detects changed-file continuations, and keeps explicit range completion distinct from repository coverage. It replaces repeated hand-written TypeScript mapping/numbering code.
- `local.shell({script,interpreter:"bash",args})` passes scripts and positional arguments literally, avoiding outer-shell expansion and temporary script files. Command mode remains supported. The provider validates alternatives before approval; exact script/arguments, workspace locking, cancellation and exit/output semantics retain the existing execution boundary. Shell still has host authority, not network isolation.
- Review guidance follows inputs through selected objects and effects, then checks guards and logs against their objects. It requires a skeptical pass over causal claims and unresolved external dependencies, inspection of security/config consumers with redacted values, and agreement between coverage claims and disclosed omissions.
- Help pages use actual serialized size instead of a worst-case escaping allowance. This improves delivery at smaller configured budgets. The installed runtime uses a larger nested-result budget: the earlier suggestion that the 3,290-character allowance caused this particular rerun was not established and was corrected.
- Source, generated guidance, public types, model tool description and packaged runtime are updated together. Standing text remains within 6,400 characters, the activated skill within 10,400, and the model tool description within 850.

## Independent forward test

A blind Codex subagent used the revised guidance and built Fabric APIs on two disposable seeded projects. It did not receive expected findings or the parent conversation. The standard oracle then checked exact source evidence and fixture integrity.

| Case | Grounded defects found | False positives | False-positive controls | Fixture changes |
| --- | ---: | ---: | ---: | ---: |
| review-infra | 5/5 | 0 | 3 | 0 |
| review-contracts | 2/2 | 0 | 3 | 0 |

The second case included the protected-object guard and false dry-run logs. Both were found. Runtime settings, validated names and caller-managed validator failure were not reported as defects. The reviewer disclosed three initial API/type mistakes and investigated empty probe output before relying on verification. Direct Node output was preserved outside the surrounding sandbox; the sandbox-specific observation did not establish a Fabric regression.

The [saved answers, scores and diagnostics](review-forward-test-2026-09-10.json) retain these limits. This was a guidance/API forward test using a Codex reviewer, not a Kiro-versus-default trial or an economic benchmark. The Kiro standing prompt and MCP description were not applied by that bridge.

## Validation and activation

Focused provider/runtime tests passed, including bounded continuation across 260 lines, stale hashes, unsafe paths, literal shell arguments, rejection before approval and a stubbed-curl probe preserving both stdout and the nonzero status. The comparison selftest qualified four review fixtures, rejected 18 buggy repair variants and accepted 18 reference repairs without inference.

The final `pnpm run check` passed: 84 test files, 1,307 passing tests and four skipped, plus guidance checks, type checking, build, dead-code lint, agent staging, packaged MCP certification and SBOM generation. A fresh `pnpm run build` also completed after this report was updated.

The source installer activated version 0.64.0, generation `ecf9aadd1dc4c36b360518bff9d89aab1e53ff61c09cf58c62f9b9fecc529c6d`, with a prior configuration backup. Installed `doctor` reported healthy. This is a local source installation; signed release distribution remains unconfigured.

A smoke test through the actual installed MCP server verified that its standing prompt and complete review help match the checkout, compiler repair hints reach the caller, `local.readMany` returns numbered evidence and hashes, and literal script arguments and nonzero exit status survive execution. It used a disposable workspace and zero inference requests. Authenticated Kiro model behavior and client resource loading were not tested.

No changes were made to `pau-security-monitor`, and no commits or paid Kiro comparisons were created. A fresh Kiro session is needed after installation. Establish a superiority claim with repeated, matched Kiro/default runs, scoring grounded findings, misses and unsupported claims alongside credits and time.
