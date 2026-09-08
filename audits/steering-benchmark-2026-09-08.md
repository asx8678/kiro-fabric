# Steering benchmark — stopped pilot, 2026-09-08

## Outcome and limits

Two Astra-reviewed implementation iterations completed before paid testing. The frozen comparison planned **102 Kiro CLI v3 Auto requests** across old Fabric, iteration 1, iteration 2 and native `vibe`, with paired fixtures, rotated/reversed ordering and two repetitions. It stopped after **20 requests**, one repetition of the first five cases. **82 requests did not run**, including the coding matrix and reverse-order repetition. This is not a completed broad comparison and does not establish universal superiority.

Raw results: **12/20 strict passes**. The explanation oracle wrongly required a particular sentence not requested by the prompt; manual review found all four explanations valid. Their raw failures remain unchanged and that case is excluded uniformly from comparative statistics, not silently relabeled. JSON-only acceptance never strips commentary or fences.

### Observed cases

| Case | Old Fabric | Iteration 1 | Iteration 2 | Native |
| --- | --- | --- | --- | --- |
| No-tool explanation | Valid; oracle defect | Valid; oracle defect | Valid; oracle defect | Valid; oracle defect |
| Complete 160-item raw JSON | Pass, no tools | Pass, no tools | Pass, no tools | Pass, no tools |
| No-tool arithmetic | Pass, no tools | Pass, no tools | Pass, no tools | Pass, no tools |
| 24 exact first lines | Pass, 1 call | Pass, 1 call | Pass, 1 call | Pass, 24 calls |
| CRLF/9,000-character line | Prose + length error (+104) | Prose + length error (-40) | Prose; data itself exact | 35 calls; timeout |

All 12 no-tool requests made zero model tool calls. Mandatory client `fetch_cloud_config` startup is excluded. Call counts are not model round trips or measured inner effects/concurrency.

### One paired 24-file snapshot

| Arm | Reported credits | Wall seconds | Model tool calls |
| --- | ---: | ---: | ---: |
| Native | 0.344742 | 18.142 | 24 |
| Old Fabric | 0.104446 | 10.321 | 1 |
| Iteration 1 | 0.104925 | 10.308 | 1 |
| Iteration 2 | 0.091626 | 10.482 | 1 |

Iteration 2 used 73.4% fewer reported credits than native on this single matched task. Auto's routed model, cache usage and settled billing are unavailable; this is a descriptive observation, not a confidence-qualified aggregate speed/quality claim. Other failures and charges are retained in the companion JSON.

## Safety stop and accounting

Native's range case hit the 150-second limit after 35 model tool calls. The client exited on SIGTERM without `runFinished` or terminal usage. The controller recorded the failure and blocked further admission. Its exact local v3 session remains `in_progress`; neither the stream nor that session's messages contains a credit/turn-completion receipt. An unrelated active CLI receipt was left untouched. No model resume, billing estimate, retry, or additional Kiro inference followed.

Known new reported usage: **2.1425728728026536 credits**, plus **one unknown-charge attempt**. Earlier conversation usage was approximately 13.512289, making **15.654861872802655 known reported conversation credits plus the unresolved attempt**. The total is deliberately `null`, not an estimate. Original admission settings: 20 new planned credits, 40 conversation-total ceiling, 5-credit reserve, 0.8 per-completed-run stop, 40 tool starts, 150 seconds and 8 MiB combined output. These are controller checks, not an account-side hard charge cap.

Astra used eight separate openai-codex agent runs, approximately **$10.831772 reported by that provider**. This is not Kiro usage and is not converted into credits.

## Concrete findings and changes

1. Kiro 2.21.1 concatenates visible `agent_message_chunk` text across tool calls into `runFinished.finalText`. Iteration 2's last range message contained exact data, but a 224-character inter-tool explanation invalidated the entire JSON answer. Standing/skill/workflow guidance now explicitly forbids visible inter-tool commentary for JSON-only requests. This remains steering, not a hard decoder.
2. `local.read` returned all four requested whole lines. `truncated:true,nextOffset:45` meant only that the file continued beyond lines 41–44. Hot descriptions, guest declarations and help now explain that distinction and CRLF-safe splitting. A regression asserts the exact raw CRLF text and full 9,000-character line. Runtime read semantics and approval boundaries are unchanged.
3. The explanation whitelist was not a valid free-form semantic oracle. Future v2 requests the exact supplied sentence and compares it literally; it no longer claims explanation-quality grading. The rename prompt now explicitly asks to preserve every other source byte, matching its byte oracle. The range prompt requires continuation only for missing requested content.
4. Future schedules put long-output stress last across all repetitions so it cannot preempt the broad coding matrix. This changes future plans only. The stopped v1 sources and rows remain frozen.

A final public API-reference check corrected the documented reply route to include the required PR number: `POST /repos/{owner}/{repo}/pulls/{pull_number}/comments/{comment_id}/replies`. The workflow links the official GitHub documentation and distinguishes the original review-comment ID from the GraphQL thread ID. No GitHub comment was created or modified.

Post-benchmark repairs are **offline-tested, not retested via live inference** because usage reconciliation is unresolved. No claim of perfect steering or hard no-tools/output enforcement is made; see [turn-contract design](../docs/turn-contracts.md).

## Reproduction and evidence

- Machine-readable bounded report: [steering-benchmark-2026-09-08.json](steering-benchmark-2026-09-08.json).
- Private complete evidence: `/tmp/kiro-fabric-steering-contract-20260908/live-v1`, including prompts, source/fixture/oracle/profile/runtime hashes, commands, raw streams, filesystem manifests, request identities and all rows.
- Hash-identical original eight-file harness: `live-v1/frozen-harness`. Current sources are a revised future protocol and must not be used to retroactively score the old explanation prompt.
- Old complete bundle: `fca62aa2aaf0107aa7dd54c096447bebda9cd70fbd6b9de3bc92a02724d5a384`; iteration 1: `3bbcd1db724682380fd4abcc2c87b33ffb5693e6d84529fd45bf43c5d31fed39`; iteration 2: `d601dc56e83413521665072ed9efe743e2be3dc7f905046dbfcdcf7e5edc55fc`. Separate private data/config roots; global installation was not changed during comparison.
- CLI settings were re-read before/after admission; selected CLI/KAS artifacts, all Fabric bundles, profiles, configs, harness, environment and generated case inputs were identity-checked. This is not OS isolation, network blocking or a complete inventory of every ambient dependency.

Future local qualification: `node scripts/steering-benchmark.mjs selftest --python python3`. `--help` documents plan/init/run/summary. Initialization does not perform inference. Do not resume paid work while the prior charge is unresolved. Python probes execute candidate code in disposable copies; fixture audit logs are tamperable evidence, not a security sandbox.
