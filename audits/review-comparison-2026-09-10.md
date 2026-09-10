# Default Kiro and Fabric review investigation

The supplied default review has materially broader coverage. Fabric's review is cheaper but incomplete, and neither report is a reliable ground-truth answer. The useful target is higher recall at least equal precision, then lower credits and elapsed time per verified finding.

This investigation read the current `pau-security-monitor` tree at `ac47b816009541e48bbab437e7645a73b0f977cc`, without changing it or contacting its services. It contains 64 non-Git files and no C# source. Its current contents and line positions differ from parts of the pasted reviews, so these are current corroborations/corrections, not a reconstruction of the exact earlier checkout. No credential values are reproduced here.

| Supplied run | Credits | Elapsed | Investigation visible in transcript |
| --- | ---: | ---: | --- |
| Default | 13.37 | 300 seconds | Referenced maintenance script, validators, environment configs, whitelist data, Helm rendering and lint |
| Fabric | 3.76 | 112 seconds | Batched source reads; omitted the maintenance script and validators; no shell/rendering probe shown; two compiler failures |

Fabric used 71.9% fewer credits and 62.7% less elapsed time in this pair. Those savings include doing less investigation. The default footer identifies Claude Opus 5 / low; the supplied Fabric excerpt does not independently establish identical model/effort. Collapsed tool output also prevents measuring source bytes actually delivered. This is not a controlled quality comparison, and counting numbered findings would reward splitting symptoms and speculation.

## Findings checked against the actual files

| Candidate | Assessment |
| --- | --- |
| Missing notification alert | Confirmed in the local chart. Production rendering emits 13 resources and no `PrometheusRule`, despite production/staging rule values. Both reviews found it. External alert provisioning was not inspected. |
| Cleanup schedule | Confirmed: `* 13 * * 0-4` remains in the production render. It requests 60 starts during hour 13 on Sunday–Thursday, inconsistent with the weekday-once-daily comment. Both found it. |
| Cleanup API-key positions | The default found an important defect Fabric missed by never reading the called script. The pipeline passes dev/staging/prod labels with staging/prod environments; the script indexes both from zero. Actual authentication failures depend on the secret values and service policy, which were not tested. |
| Undefined `$apiKey` | Confirmed undeclared singular variable at `removeObsoleteArtifacts.ps1:43`; the parameter is `$apiKeys`. Default found it, Fabric missed it. PowerShell is unavailable locally, so strict/non-strict evaluation was not executed. |
| Dry-run deletion messages | Confirmed: the `removed.` message at script line 102 is outside `if ($force)`. Default found it, Fabric missed it. |
| Protecting master artifacts | The default correctly identified a suspicious wrong-object guard: it checks `$artifact.version` while iterating `$related` and otherwise accesses `$artifact.artifact`. The service response contract is absent, so the real deletion effect remains conditional. Fabric missed this lead. |
| Unquoted curl URL | Real argument-splitting defect, but both reports overstate the mechanism. With an inert curl function, Bash parses successfully, reports `api-version=...: command not found`, captures the fixture response and exports `BUILDID=1234`. The closing parenthesis balances `response=$(`. The omitted query parameter is established; an always-empty response is disproved. |
| Arithmetic `null` comparison | In ordinary Bash, arithmetic treats an unset identifier as zero; `[[ "null" -eq "null" ]]` can succeed. Explicit string/missing-value handling would be clearer, but the claimed guaranteed fallback failure is not established. Error options and the surrounding caller matter. |
| Cleanup can never run | Unproven. The local definition is commented, but the pipeline imports `pau-pipeline-secrets`. Azure supports variable groups and pipeline UI variables. Without those settings/run evidence, neither review can establish that `should_remove` is always absent. |
| Cron restart policy casing | Confirmed: injecting lowercase `restartPolicy=OnFailure` still renders `Never`. This is a configurable chart defect; the supplied production values use the default, so it does not establish a currently wrong production policy. |
| Ingress permissions | The chart's ClusterRole omits `networking.k8s.io`. Modern Ingress enumeration is not granted by the shown rule. Default found this, Fabric omitted it despite reading the role. Whether the application enumerates Ingresses or receives other bindings is unverified. |
| Uppercase release selectors | The proposed trigger is unreachable through normal Helm releases. `helm template UpperCase ...` rejects the release name before rendering. Fabric promoted this as a latent bug without checking input validation. |
| CVE cleanup flag and node iteration | The global `$changesMade` flag can cause later unchanged files to be saved if multiple files are scanned. Suppressing the final “no outdated CVEs” message after a real change is correct. Neither transcript proves the XML iteration skips nodes; the actual PowerShell collection/runtime must be checked. |
| Expired whitelist proves pipeline failure | Incorrect inference. The cleanup retains entries for a month and proposes a PR; an expired row alone proves neither a missing run nor a failed merge. The current file has 191 entries, 25 expired before 2026-09-10, and three duplicate digest/repository/CVE keys. Its 23 tagged repository values need the absent application's matching contract before being called inert. |
| Plaintext signed connectors | Current dev/staging/prod files each contain ten signed URL strings. Report credential-bearing locations and move/rotate through the normal process; do not claim signatures are currently valid or test them by sending notifications. Default inspected this area; Fabric omitted it. |
| Validators cannot fail CI | No pipeline references to the named validators were found. A future CI failure claim must inspect the caller's error policy. `Test-Json` can emit an error as well as `False`, and Azure's PowerShell task defaults its error preference to `stop`. Also `Test-Json -Path` was added in 7.4, not 7.3 as the default analysis said. |
| PR enters production stage | Entering a named stage does not prove deployment. The caller sets `test:true`, passes `run_upgrade:false`, and the local shared template gates the upgrade on `run_upgrade`. No production deployment from a PR was demonstrated. |
| Null labels, PDB, chart version, value mutation, Compose ordering | A no-op PDB may be intentional; a null YAML value needs actual decoder/API validation; chart v1/version `0.0.0` is not a defect by itself. Shared-value mutation and service readiness ordering need a concrete bad result. These should not inflate a confirmed-defect count. |

The service/fullname mismatch is a valid configurable-chart concern: the current common `fullnameOverride` makes names agree. Missing common application settings, whitelist layering and owner overrides likewise need the missing application's loader/defaults before asserting deployed behavior. Documentation discrepancies can be reported separately without inventing runtime effects.

Primary references for platform behavior: [Azure variable definitions](https://learn.microsoft.com/en-us/azure/devops/pipelines/process/variables?view=azure-devops), [Test-Json](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.utility/test-json?view=powershell-7.5), [PowerShell task error policy](https://learn.microsoft.com/en-us/azure/devops/pipelines/tasks/reference/powershell-v2?view=azure-pipelines), and [Kubernetes Ingress](https://kubernetes.io/docs/concepts/services-networking/ingress/).

## Why Fabric fell short

1. **Installed instructions lag the checkout.** At the start of this investigation, `/home/adam/.kiro/agents/kiro-fabric.json` did not match `AGENT_PROMPT` and contained no coverage ledger. Its installed skill also lacked the review reference file. Its immutable generation began `5d06d315`. The checkout already included `70fb2ab`'s review guidance. A build alone does not update this separate installation or an already running session. This is a verified current mismatch, not proof of the exact profile used in the earlier transcript.
2. **Compiler recovery consumed effort without improving evidence.** `{}` rejects dynamic indexing; changing to `Record<string, unknown>` then fails the JSON return type. Fabric finally flattened results to strings. Both failures can be avoided by preserving inferred arrays or using the existing `JsonObject`/specific record types.
3. **Coverage was confused with finding enough issues.** Fabric stopped after reading the launcher, without reading its called cleanup script, validators or the remaining environment/data files. Its final “whole repo” claim exceeds the visible inspection.
4. **Plausible explanations were accepted without probes.** Both reports repeated incorrect Bash conclusions. The Helm name claim could have been rejected with one local command. More output or a higher findings quota would amplify this problem.

## Implemented improvements

- Compiler diagnostics now include numeric TypeScript codes and targeted dictionary/JSON hints. Compilation remains strict; regression tests prove failed snippets execute no preceding write/provider effect and corrected snippets preserve structured results through the real compiler and guest.
- Standing guidance prioritizes recursive review orientation, reachable inputs, referenced consumers, open leads and disclosed coverage. It stays inside the existing 6,400-character standing budget and 10,400-character skill budget.
- Review help includes a checked, executable batching recipe that preserves source line numbers, whole-file size, unread suffixes and content hashes, including empty files, EOF, CRLF and Unicode. Tool composition reduces overhead without hiding missing evidence.
- The new opt-in `review-contracts` benchmark exercises protected-version selection and dry-run reporting, with false-positive controls for validated release names, runtime settings and caller-managed validator exits. Existing `review-infra` fixtures remain unchanged. Both benchmarks have independent, inert Node probes; synthetic results are not agent-quality measurements.

## Validation and activation

- `pnpm run check` passed: 83 test files, 1,298 passing tests and four skips; typecheck, fresh build, dead-code lint, component MCP certification and SBOM generation completed. An initial missing audit-inventory entry for the new test was corrected before the passing full run.
- `pnpm run comparison:selftest` passed: 18 buggy project variants rejected, 18 reference repairs accepted and four review fixtures independently qualified; zero inference requests. Existing `review-infra` prompt and fixture hashes match the prior implementation for both seeds.
- The managed source installer rebuilt and activated version `0.64.0`, generation `bd0fd2d21efcc70e2c242f740bbbfbc71c8c3f49b2eeb3d00ab877d394be7625`. Previous configuration backup: `/home/adam/.kiro/kiro-fabric/backups/20260909T223706Z-f66b9de18e9137ee`.
- Installation doctor reports healthy. A direct no-model test of the installed MCP confirmed exact standing-prompt and review-help parity, the new compiler hint on the failing dictionary snippet, and successful execution of the corrected JSON program. The probe used the required managed data binding and an empty temporary workspace; overriding that binding was correctly rejected during probe setup.
- The generic Codex skill validator rejects the pre-existing Kiro-specific `compatibility` frontmatter. The repository's native skill/package validation passes; that Kiro metadata was preserved.

Restart Kiro into a new session to adopt the updated generation. Existing sessions retain their prior files. No commits were created, and `pau-security-monitor` was left unchanged.

## How to establish superiority

Use fresh workspaces and the same explicitly selected model/effort, both orders and repeated trials. Start with `review-infra` and `review-contracts`, then use a separately adjudicated real repository. Freeze prompts, source hashes and installed generations. Count unique grounded findings, missed important defects, false positives, unsupported coverage claims and failed tool calls. Compare credits/time only once coverage and precision are acceptable. Include failed/canceled trials and unknown telemetry.

No paid model comparison was started in this investigation. Passing compiler, fixture and packaging tests proves the changes work as implemented; it does not prove Fabric now outperforms the default model on arbitrary reviews.
