# Latest Kiro Fabric review: comparison and refinement

The latest supplied run improves efficiency and recovers useful findings inside the cleanup script. It does not yet demonstrate consistently better review quality than default Kiro: it still omits supported defects and promotes conditional consequences to verified failures. Default Kiro also overstates several of the same issues, so its finding count is not a ground-truth score.

| Supplied run | Credits | Wall time | Visible behavior |
| --- | ---: | ---: | --- |
| Default Kiro | 13.37 | 5m00s | Broad inspection and Helm rendering; several unsupported runtime/security claims |
| Original Fabric | 3.76 | 1m52s | Two TypeScript failures; narrower inspection; no visible executable verification |
| First updated Fabric | 6.21 | 3m32s | One TypeScript failure; Bash/Helm verification; explicit omitted scope |
| Latest Fabric | 5.34 | 2m14s | No visible TypeScript failures; numbered batch reads and literal Bash; more cleanup/config findings, but dropped findings and excessive certainty |

Latest versus the preceding Fabric run: 14.0% fewer credits and 36.8% less wall time. Versus default: 60.1% fewer credits and 55.3% less wall time. Versus original Fabric it costs 42.0% more and takes 19.6% longer while investigating more behavior. These are descriptive ratios from four user-supplied footers, not repeated controlled trials. The transcript hides tool results and does not retain a checkout hash for each run; total recall and statistical superiority cannot be calculated from it.

## What improved and what remains

| Area | Default | Original Fabric | Prior Fabric | Latest Fabric |
| --- | --- | --- | --- | --- |
| Positional API-key mismatch | Found | Missed | Found | Found |
| Incorrect protected-object guard | Conditional | Missed | Missed | Found, consequence overstated |
| False dry-run deletion log | Found | Missed | Missed | Found |
| Missing alert template / incorrect cron | Found | Found | Found | Found |
| Restart-policy key casing | Found | Found | Found | Omitted despite reading its template |
| Ingress permission API group | Found | Missed | Missed | Missed despite reading its role |
| Credential/config inspection | Broad, overclaims liveness | Limited | Explicitly skipped | Resumed partly, overclaims liveness |
| URL diagnosis | Incorrect lost-stdout claim | Incorrect extra-parenthesis claim | Corrected by probe | Probe useful, final fallback claim unsupported |

The strongest next improvement is precision and reconciliation of findings, not more TypeScript machinery. The new APIs are being used successfully. Repeated file names in the collapsed transcript do not establish wasted reads: the preceding batch may have exhausted its budget before delivering that file.

## Independent checks against the reviewed checkout

Inspected `/home/adam/pau-security-monitor` at `ac47b816009541e48bbab437e7645a73b0f977cc`, without modifying it or contacting application/cluster services. Structured results are in `review-iteration-2026-09-10.json`.

- **Bash consequence:** extracted the actual build-ID script and replaced the access-token/organization macros with dummy values and `curl` with an inert function. Through the same script, `{"id":123}` produces BUILDID `123`; `{}` and malformed input produce `latest`. All three emit the missing `api-version` command error and finish with status zero. Thus the dropped query parameter is confirmed, but unconditional fallback and lost stdout are disproved. The closing parenthesis belongs to command substitution; it is not the command that fails. The stub cannot predict Azure's actual response.
- **Restart-policy omission:** rendered the chart with the real common/environment values. Supplying `restartPolicy: OnFailure` for one job still renders `Never`; supplying the template's `RestartPolicy: OnFailure` renders `OnFailure`. This is a supported-setting defect hidden by the default. Initial probe setup incorrectly addressed the jobs collection; it was corrected after inspecting the actual `serviceCallingCronJobs.jobs` structure, before accepting evidence.
- **Alert/cron:** dev, staging and prod render successfully offline. No `PrometheusRule` is emitted; staging/prod render the hourly burst schedule. This demonstrates the local chart's output, not absence of every possible externally managed alert.
- **Permission target:** the chart grants `ingresses` only in core/`extensions`, but uses `networking.k8s.io` for its Ingress. That rule does not grant the modern API permission. Actual authorization also depends on other role bindings; a live 403 is not proven. See [Kubernetes Ingress API](https://kubernetes.io/docs/reference/kubernetes-api/networking/ingress-v1/) and [RBAC authorization](https://kubernetes.io/docs/reference/access-authn-authz/rbac/).
- **External variable:** the nightly pipeline imports `pau-pipeline-secrets`. The commented local definition cannot establish that `should_remove` is unavailable in that group or pipeline/UI settings. The correct statement is conditional on its effective value. See [Azure variable sources and scope](https://learn.microsoft.com/en-us/azure/devops/pipelines/process/variables?view=azure-devops).
- **Protected-version guard:** the tested expression uses the response wrapper, while the selected object is `$related`. That inconsistency warrants review. Without the API schema/capture or application source, asserting that the wrapper property never exists or that production master artifacts are definitely deleted is unjustified. The later in-use filter and force flag also affect deletion.
- **XML enumeration:** no PowerShell runtime is installed here. Moreover, PowerShell's current XML adapter materializes matched nodes and returns an object array for multiple matches; this contradicts assuming every XML property enumeration is a live `XmlNodeList`. The repeated skip-elements claim is unsupported for this script without a matching-runtime counterexample. See [`XmlNodeAdapter` source](https://github.com/PowerShell/PowerShell/blob/master/src/System.Management.Automation/engine/CoreAdapter.cs).
- **Search/security scope:** the latest validator search omits `hidden:true`, whose default is false. That search alone cannot establish absence of hidden CI callers. A signature parameter in source establishes credential-shaped storage, not liveness or successful unauthorized posting. Inspecting one connector file does not support an all-environments claim.

## Implemented refinement

The standing prompt now requires reconciliation of leads and uncertainty beside each claim. The review guide compares producer/consumer keys, permission tuples and supported non-default values; distinguishes local mismatches from reproduced behavior and conditional consequences; and checks that branch conditions agree across findings. A checked caller-search recipe includes hidden CI and returns search scope. Probe guidance requires connected input-to-output tests and preservation of the tested exit status, rather than treating a separately fed constant as evidence about upstream behavior.

The guide grew from 7,729 to 7,803 characters and still fits the default first help page. The standing prompt became shorter. Existing numbered reads, literal shell semantics, permissions and runtime interfaces are unchanged.

The opt-in `review-boundaries` fixture adds three reproducible defects and five false-positive controls: exact key casing, permission targets and an unquoted query, versus lost-response/unconditional-fallback claims, externally supplied flags, hidden validation callers and synthetic credentials. Node/Bash qualification exercises consumers and both successful/failed response paths. Earlier review fixtures and prompts retain their hashes. The exported manifest moves to version 4; existing default paid schedules do not expand.

## Validation and installation

Validation passed: 107 focused tests; full `pnpm run check` with 84 test files, 1,311 passing tests and four skipped tests; typechecking, dead-code checks, packaged MCP certification and SBOM generation. `comparison:selftest` independently qualified all three review cases under two seeds, plus the existing 18 buggy/reference repair pairs, without inference. Existing review fixture/prompt hashes were checked unchanged. The generic Codex skill validator rejects this Kiro skill's pre-existing `compatibility` frontmatter key; that field was retained rather than changing the product metadata to satisfy an unrelated schema.

The blind forward test used a fresh agent with the candidate standing instructions and real checked Fabric APIs over an isolated fixture. It found 3/3 defects, with zero false positives or duplicates, avoiding all five negative controls. Fixture files were verified unchanged; the original answer and diagnostics are preserved in the JSON artifact. The reviewer recovered from one grep escaping error and missing asynchronous Node output under the surrounding sandbox, using explicit synchronous output for verification. No claim of flawless tool use is made.

This is not Claude running in Kiro, and there is no matched default arm. Its source/evidence oracle grades the fixture's enumerated claims, not arbitrary prose or production truth. No paid Kiro comparison, remote deployment or application cleanup was run.

Installed the tested source generation `cf4bec4d865a0487c71980f867b9697767f8b098d8b9d5c9f517d5d7fdff3d45` into the managed `/home/adam/.kiro/agents/kiro-fabric.json` profile. Installer backend verification, offline doctor and the actual installed MCP smoke passed. The smoke checks installed prompt equality, the complete updated review help, checked compiler diagnostics, numbered reads, literal arguments and exit-status preservation. The existing lack of a production signing trust root affects signed distribution, not this local-source installation. Authenticated Kiro/model behavior is untested; restart Kiro to load the new generation. No Git commit was created.
