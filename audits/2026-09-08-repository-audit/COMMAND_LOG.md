# Recorded command index

Exact argv, cwd, limits and non-secret environment are in [command-index.json](evidence/command-index.json). Each evidence link contains the recorded output; source reads are preserved with line numbers. A logger command records the actual child argv; `audit.py` applies the stated timeout and synthetic environment. Initial read commands used the host environment. A passed command means that command completed, not that the repository passed an audit.

| ID | Purpose | Status / exit | Time (s) | Evidence |
|---|---|---|---:|---|
| C-001 | Record target root | passed / 0 | not recorded | [record](evidence/orientation-commands.json) |
| C-002 | Record branch and dirty working tree | passed / 0 | not recorded | [record](evidence/orientation-commands.json) |
| C-003 | Attempt baseline identity | failed / 1 | not recorded | [record](evidence/orientation-commands.json) |
| C-004 | Locate conventions and setup configuration | passed / 0 | not recorded | [record](evidence/orientation-commands.json) |
| C-005 | Read baseline identity after sandbox failure | passed / 0 | not recorded | [record](evidence/orientation-commands.json) |
| C-006 | Attempt setup safety review | failed / 1 | not recorded | [record](evidence/orientation-commands.json) |
| C-007 | Inventory significant authored files | passed / 0 | not recorded | [record](evidence/orientation-commands.json) |
| C-008 | Characterize tracked uncommitted changes | passed / 0 | not recorded | [record](evidence/orientation-commands.json) |
| C-009 | Attempt dependency/output existence check | failed / 1 | not recorded | [record](evidence/orientation-commands.json) |
| C-010 | Inspect commands, compiler and test configuration | passed / 0 | not recorded | [record](evidence/orientation-commands.json) |
| C-011 | Confirm dependencies exist and output directory is new | failed / 2 | not recorded | [record](evidence/orientation-commands.json) |
| C-012 | Inspect docs, CI and build/install policy | passed / 0 | not recorded | [record](evidence/orientation-commands.json) |
| C-013 | Inspect closure and staging lifecycle | passed / 0 | not recorded | [record](evidence/orientation-commands.json) |
| C-014 | Inspect bundle/private-tool/certification lifecycle | passed / 0 | not recorded | [record](evidence/orientation-commands.json) |
| C-015 | Hash dirty baseline and create disposable execution copy | passed / 0 | 0.596 | [record](evidence/C-015.json) |
| C-016 | Measure authored size and Git signals | passed / 0 | 1.851 | [record](evidence/C-016.json) |
| C-017 | Read bounded source, callers, guards and error paths | passed / 0 | 0.001 | [record](evidence/C-017.json) |
| C-018 | Record Node version | passed / 0 | 0.003 | [record](evidence/C-018.json) |
| C-019 | Record Node runtime environment | passed / 0 | 0.019 | [record](evidence/C-019.json) |
| C-020 | Record pnpm version | passed / 0 | 1.372 | [record](evidence/C-020.json) |
| C-021 | Search test/lifecycle environment, network, spawn and conditional-test leads | passed / 0 | 0.009 | [record](evidence/C-021.json) |
| C-022 | Read bounded source, callers, guards and error paths | passed / 0 | 0.001 | [record](evidence/C-022.json) |
| C-023 | Read bounded source, callers, guards and error paths | passed / 0 | 0.0 | [record](evidence/C-023.json) |
| C-024 | Read bounded source, callers, guards and error paths | passed / 0 | 0.0 | [record](evidence/C-024.json) |
| C-025 | Attempt full documented baseline check; dependency provisioning interrupted before checks | failed / -15 | 447.559 | [record](evidence/C-025.json) |
| C-026 | Read bounded source, callers, guards and error paths | passed / 0 | 0.0 | [record](evidence/C-026.json) |
| C-027 | Read bounded source, callers, guards and error paths | passed / 0 | 0.0 | [record](evidence/C-027.json) |
| C-028 | Read bounded source, callers, guards and error paths | passed / 0 | 0.0 | [record](evidence/C-028.json) |
| C-029 | Read bounded source, callers, guards and error paths | passed / 0 | 0.0 | [record](evidence/C-029.json) |
| C-030 | Read bounded source, callers, guards and error paths | passed / 0 | 0.0 | [record](evidence/C-030.json) |
| C-031 | Read bounded source, callers, guards and error paths | passed / 0 | 0.0 | [record](evidence/C-031.json) |
| C-032 | Read bounded source, callers, guards and error paths | passed / 0 | 0.0 | [record](evidence/C-032.json) |
| C-033 | Read bounded source, callers, guards and error paths | passed / 0 | 0.0 | [record](evidence/C-033.json) |
| C-034 | Read bounded source, callers, guards and error paths | passed / 0 | 0.0 | [record](evidence/C-034.json) |
| C-035 | Read bounded source, callers, guards and error paths | passed / 0 | 0.0 | [record](evidence/C-035.json) |
| C-036 | Read bounded source, callers, guards and error paths | passed / 0 | 0.0 | [record](evidence/C-036.json) |
| C-037 | Read bounded source, callers, guards and error paths | passed / 0 | 0.0 | [record](evidence/C-037.json) |
| C-038 | Read bounded source, callers, guards and error paths | passed / 0 | 0.0 | [record](evidence/C-038.json) |
| C-039 | Read bounded source, callers, guards and error paths | passed / 0 | 0.0 | [record](evidence/C-039.json) |
| C-040 | Read bounded source, callers, guards and error paths | passed / 0 | 0.0 | [record](evidence/C-040.json) |
| C-041 | Read bounded source, callers, guards and error paths | passed / 0 | 0.0 | [record](evidence/C-041.json) |
| C-042 | Read bounded source, callers, guards and error paths | passed / 0 | 0.0 | [record](evidence/C-042.json) |
| C-043 | Read bounded source, callers, guards and error paths | passed / 0 | 0.001 | [record](evidence/C-043.json) |
| C-044 | Locate installer/release entry and trust paths | passed / 0 | 0.008 | [record](evidence/C-044.json) |
| C-045 | Read bounded source, callers, guards and error paths | passed / 0 | 0.0 | [record](evidence/C-045.json) |
| C-046 | Read bounded source, callers, guards and error paths | passed / 0 | 0.0 | [record](evidence/C-046.json) |
| C-047 | Read bounded source, callers, guards and error paths | passed / 0 | 0.0 | [record](evidence/C-047.json) |
| C-048 | Attempt synthetic storage fault probe; dependency unavailable | failed / 1 | 0.019 | [record](evidence/C-048.json) |
| C-049 | Read bounded source, callers, guards and error paths | passed / 0 | 0.0 | [record](evidence/C-049.json) |
| C-050 | Locate dependency setup and package-install test callers | passed / 0 | 0.008 | [record](evidence/C-050.json) |
| C-051 | Read bounded source, callers, guards and error paths | passed / 0 | 0.0 | [record](evidence/C-051.json) |
| C-052 | Inspect pnpm dependency metadata after interrupted provisioning | failed / 2 | 0.007 | [record](evidence/C-052.json) |
| C-053 | Inspect only audit descendant processes during failed setup | passed / 0 | 0.022 | [record](evidence/C-053.json) |
| C-054 | Read bounded source, callers, guards and error paths | passed / 0 | 0.0 | [record](evidence/C-054.json) |
| C-055 | Restore independent disposable dependencies | passed / 0 | 0.385 | [record](evidence/C-055.json) |
| C-056 | Run full documented check with existing dependencies and bounded network | failed / 1 | 214.6 | [record](evidence/C-056.json) |
| C-057 | Reproduce memory close and artifact deletion failure behavior with synthetic data | passed / 0 | 0.056 | [record](evidence/C-057.json) |
| C-058 | Attempt MCP/config source read using incorrect paths | failed / 1 | not recorded | [record](evidence/C-058.json) |
| C-059 | Inventory source/scripts/tests/docs/workflows | passed / 0 | 0.008 | [record](evidence/C-059.json) |
| C-060 | Read bounded source, callers, guards and error paths | passed / 0 | 0.0 | [record](evidence/C-060.json) |
| C-061 | Read bounded source, callers, guards and error paths | passed / 0 | 0.001 | [record](evidence/C-061.json) |
| C-062 | Read bounded source, callers, guards and error paths | passed / 0 | 0.001 | [record](evidence/C-062.json) |
| C-063 | Query npm dependency advisory scanner | passed / 0 | 0.554 | [record](evidence/C-063.json) |
| C-064 | Read bounded source, callers, guards and error paths | passed / 0 | 0.001 | [record](evidence/C-064.json) |
| C-065 | Read bounded source, callers, guards and error paths | passed / 0 | 0.001 | [record](evidence/C-065.json) |
| C-066 | Read bounded source, callers, guards and error paths | passed / 0 | 0.001 | [record](evidence/C-066.json) |
| C-067 | Read bounded source, callers, guards and error paths | passed / 0 | 0.0 | [record](evidence/C-067.json) |
| C-068 | Read bounded source, callers, guards and error paths | passed / 0 | 0.0 | [record](evidence/C-068.json) |
| C-069 | Inspect audit descendant processes while tests run | passed / 0 | 0.025 | [record](evidence/C-069.json) |
| C-070 | Read bounded source, callers, guards and error paths | passed / 0 | 0.0 | [record](evidence/C-070.json) |
| C-071 | Read bounded source, callers, guards and error paths | passed / 0 | 0.0 | [record](evidence/C-071.json) |
| C-072 | Read bounded source, callers, guards and error paths | passed / 0 | 0.0 | [record](evidence/C-072.json) |
| C-073 | Read bounded source, callers, guards and error paths | passed / 0 | 0.0 | [record](evidence/C-073.json) |
| C-074 | Inventory literal module graph, dependency usage and test markers | passed / 0 | 0.258 | [record](evidence/C-074.json) |
| C-075 | Scan bounded current and historical authored text for high-specificity secret patterns | passed / 0 | 4.38 | [record](evidence/C-075.json) |
| C-076 | Verify direct dependency resolutions and current public registry metadata | passed / 0 | 1.652 | [record](evidence/C-076.json) |
| C-077 | Read bounded source, callers, guards and error paths | passed / 0 | 0.0 | [record](evidence/C-077.json) |
| C-078 | Read bounded source, callers, guards and error paths | passed / 0 | 0.0 | [record](evidence/C-078.json) |
| C-079 | Run dead-code lint after full-check test stage blocked | passed / 0 | 1.098 | [record](evidence/C-079.json) |
| C-080 | Run synthetic stdio component certification | passed / 0 | 1.306 | [record](evidence/C-080.json) |
| C-081 | Generate application-closure SBOM | passed / 0 | 0.445 | [record](evidence/C-081.json) |
| C-082 | Run bounded offline fixture/help preparation probe | passed / 0 | 1.198 | [record](evidence/C-082.json) |
| C-083 | Provision disposable copy of existing pnpm store for focused package test | passed / 0 | 5.152 | [record](evidence/C-083.json) |
| C-084 | Diagnose package-consumer test with permitted public registry metadata | failed / 1 | 4.478 | [record](evidence/C-084.json) |
| C-085 | Reproduce MCP snapshot close failure with empty synthetic configuration | passed / 0 | 0.247 | [record](evidence/C-085.json) |
| C-086 | Read bounded source, callers, guards and error paths | passed / 0 | 0.0 | [record](evidence/C-086.json) |
| C-087 | Read bounded source, callers, guards and error paths | passed / 0 | 0.0 | [record](evidence/C-087.json) |
| C-088 | Read bounded source, callers, guards and error paths | passed / 0 | 0.0 | [record](evidence/C-088.json) |
| C-089 | Record Git, ripgrep, OS and libc versions | passed / 0 | 0.023 | [record](evidence/C-089.json) |
| C-090 | Verify original non-audit baseline remains unchanged | passed / 0 | 0.043 | [record](evidence/C-090.json) |
| C-091 | Read bounded source, callers, guards and error paths | passed / 0 | 0.0 | [record](evidence/C-091.json) |
| C-092 | Read bounded source, callers, guards and error paths | passed / 0 | 0.0 | [record](evidence/C-092.json) |
| C-093 | Read bounded source, callers, guards and error paths | passed / 0 | 0.001 | [record](evidence/C-093.json) |
| C-094 | Search explicit property/snapshot and unfinished-code markers; exit 1 means no matches | failed / 1 | 0.008 | [record](evidence/C-094.json) |
| C-095 | Read all four CI/release/qualification workflow definitions within recorded ranges | passed / 0 | 0.0 | [record](evidence/C-095.json) |
| C-096 | Diagnose copied pnpm store path after user-requested retry | passed / 0 | 0.325 | [record](evidence/C-096.json) |
| C-097 | Verify pnpm accepts an explicit store path ending in v11 | passed / 0 | 0.309 | [record](evidence/C-097.json) |
| C-098 | Correct only the disposable store layout and dependency metadata | passed / 0 | 0.023 | [record](evidence/C-098.json) |
| C-099 | Retry unchanged fresh-consumer package test after store correction | passed / 0 | 4.717 | [record](evidence/C-099.json) |
| C-100 | Retry full documented check with corrected private store and public registry metadata | passed / 0 | 181.301 | [record](evidence/C-100.json) |
| C-101 | Finish with fresh build in disposable copy | passed / 0 | 3.528 | [record](evidence/C-101.json) |
| C-102 | Verify original non-audit baseline at handback | passed / 0 | 0.047 | [record](evidence/C-102.json) |
| C-103 | Validate report citations, links, finding IDs and recorded source ranges | passed / 0 | 0.144 | [record](evidence/C-103.json) |
| C-104 | Read final bootstrap gate and clean-consumer import assertions | passed / 0 | 0.0 | [record](evidence/C-104.json) |
| I-001 | Attempt focused fix verification; sandbox DNS prevented Corepack setup | failed / 1 | 0.068 | [record](evidence/I-001.json) |
| I-002 | Run focused storage, memory, MCP and artifact regressions after sandbox retry | passed / 0 | 5.45 | [record](evidence/I-002.json) |
| I-003 | Run full documented check against user-authorized fixes in the working tree | passed / 0 | 173.487 | [record](evidence/I-003.json) |
| I-004 | Rebuild live dist after fix validation for immediate Kiro use | passed / 0 | 4.545 | [record](evidence/I-004.json) |
| I-005 | Compare full baseline; detect six concurrent additions from a separate audit | failed / 1 | 0.071 | [record](evidence/I-005.json) |
| I-006 | Validate final audit report and remediation links against the retained audit snapshot | passed / 0 | 0.11 | [record](evidence/I-006.json) |
| I-007 | Verify application scope while explicitly recording concurrent audit additions | passed / 0 | 0.076 | [record](evidence/I-007.json) |
| I-008 | Locate integration callers during user-requested Astra review | passed / 0 | 0.008 | [record](evidence/I-008.json) |
| I-009 | Read runtime/server integration; stop on an incorrect memory-provider path | failed / 1 | 0.098 | [record](evidence/I-009.json) |
| I-010 | Read corrected memory provider and remaining artifact/memory integration paths | passed / 0 | 0.028 | [record](evidence/I-010.json) |
| I-011 | Reproduce six newly added metadata-failure regressions before correction | failed / 1 | 2.715 | [record](evidence/I-011.json) |
| I-012 | Verify both bounded identity recovery fixes and related storage behavior | passed / 0 | 7.399 | [record](evidence/I-012.json) |
| I-013 | Run full documented check after Astra review corrections | passed / 0 | 200.105 | [record](evidence/I-013.json) |
| I-014 | Finish Astra review corrections with a fresh live build | passed / 0 | 5.422 | [record](evidence/I-014.json) |
| I-015 | Confirm final authored scope and explicitly record concurrent audit additions | passed / 0 | 0.072 | [record](evidence/I-015.json) |
| I-016 | Validate final report after Astra review and completed validation evidence | passed / 0 | 0.231 | [record](evidence/I-016.json) |
| I-017 | Check standalone commit source; symlinked dependencies caused unwanted generated path changes | passed / 0 | 157.509 | [record](evidence/I-017.json) |
| I-018 | Check standalone commit with local dependencies and matching generated artifacts | passed / 0 | 158.602 | [record](evidence/I-018.json) |
| I-019 | Finish the standalone commit with a fresh build | passed / 0 | 8.296 | [record](evidence/I-019.json) |
| I-020 | Validate audit report and remediation links before commit | passed / 0 | 0.183 | [record](evidence/I-020.json) |

C-003/C-006/C-009 failed during sandbox initialization; C-005/C-010/C-011 are their explicit retries. C-011's exit 2 simply establishes that the new output directory did not exist. C-025 ended with SIGTERM (-15) after dependency preparation attempted registry access; it did not execute typecheck or tests. C-048/C-052 reflect that interrupted preparation. C-058 is a reconstructed failed path lookup with no source evidence. C-056 and C-084 preserve their original failed results. On the user's retry, C-096/C-097 identified that the audit's copied store had lost its v11 suffix; pnpm therefore read an empty nested store. C-098 corrected only the disposable layout. C-099 then passed all nine unchanged package-boundary tests, and C-100 records the subsequent full check. Do not reinterpret the earlier failed commands as passed. C-094 is a no-match rg search (exit 1), not an application failure.

Not run: authenticated Kiro qualification; native macOS/ARM qualification; coverage (provider absent); publish/deploy/real-home install; production MCP/OAuth calls; branch-protection inspection. No repeated stress/flakiness or exhaustive filesystem fault campaign was performed.
