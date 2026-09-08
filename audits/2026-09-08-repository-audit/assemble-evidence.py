#!/usr/bin/env python3
"""Assemble audit indexes from existing evidence; never writes outside this audit."""
import hashlib
import json
import pathlib
import re
import shlex

OUT = pathlib.Path(__file__).resolve().parent
EVIDENCE = OUT / "evidence"

def write(name, value):
    (EVIDENCE / name).write_text(json.dumps(value, indent=2) + "\n")

commands = {entry["id"]: entry for entry in json.loads((EVIDENCE / "orientation-commands.json").read_text())}
for file in sorted([*EVIDENCE.glob("C-*.json"), *EVIDENCE.glob("I-*.json")]):
    entry = json.loads(file.read_text())
    commands[entry["id"]] = entry

if "C-058" not in commands:
    commands["C-058"] = {
        "id": "C-058",
        "command": ["python3", "audits/2026-09-08-repository-audit/audit.py", "C-058", "read", "src/providers/mcp-provider.ts:1:400", "src/kiro/power/config.ts", "src/kiro/power/agent-launch-context.ts", "src/kiro/power/workspace-binding.ts"],
        "cwd": "/home/adam/projects/kiro-fabric",
        "status": "failed",
        "exit": 1,
        "elapsed_seconds": None,
        "output": "FileNotFoundError: disposable repo/src/providers/mcp-provider.ts does not exist. No source was read. Corrected paths were inspected in C-061.",
        "provenance": "Reconstructed from the original command transcript, 2026-09-07T22:54:12.298Z. The logger failed before persisting this ID; this is not a rerun.",
    }
    write("C-058.json", commands["C-058"])

purposes = {
    "C-001": "Record target root", "C-002": "Record branch and dirty working tree",
    "C-003": "Attempt baseline identity", "C-004": "Locate conventions and setup configuration",
    "C-005": "Read baseline identity after sandbox failure", "C-006": "Attempt setup safety review",
    "C-007": "Inventory significant authored files", "C-008": "Characterize tracked uncommitted changes",
    "C-009": "Attempt dependency/output existence check", "C-010": "Inspect commands, compiler and test configuration",
    "C-011": "Confirm dependencies exist and output directory is new", "C-012": "Inspect docs, CI and build/install policy",
    "C-013": "Inspect closure and staging lifecycle", "C-014": "Inspect bundle/private-tool/certification lifecycle",
    "C-015": "Hash dirty baseline and create disposable execution copy", "C-016": "Measure authored size and Git signals",
    "C-018": "Record Node version", "C-019": "Record Node runtime environment", "C-020": "Record pnpm version",
    "C-021": "Search test/lifecycle environment, network, spawn and conditional-test leads",
    "C-025": "Attempt full documented baseline check; dependency provisioning interrupted before checks",
    "C-044": "Locate installer/release entry and trust paths", "C-048": "Attempt synthetic storage fault probe; dependency unavailable",
    "C-050": "Locate dependency setup and package-install test callers", "C-052": "Inspect pnpm dependency metadata after interrupted provisioning",
    "C-053": "Inspect only audit descendant processes during failed setup", "C-055": "Restore independent disposable dependencies",
    "C-056": "Run full documented check with existing dependencies and bounded network",
    "C-057": "Reproduce memory close and artifact deletion failure behavior with synthetic data",
    "C-058": "Attempt MCP/config source read using incorrect paths", "C-059": "Inventory source/scripts/tests/docs/workflows",
    "C-063": "Query npm dependency advisory scanner", "C-069": "Inspect audit descendant processes while tests run",
    "C-074": "Inventory literal module graph, dependency usage and test markers",
    "C-075": "Scan bounded current and historical authored text for high-specificity secret patterns",
    "C-076": "Verify direct dependency resolutions and current public registry metadata",
    "C-079": "Run dead-code lint after full-check test stage blocked", "C-080": "Run synthetic stdio component certification",
    "C-081": "Generate application-closure SBOM", "C-082": "Run bounded offline fixture/help preparation probe",
    "C-083": "Provision disposable copy of existing pnpm store for focused package test",
    "C-084": "Diagnose package-consumer test with permitted public registry metadata",
    "C-085": "Reproduce MCP snapshot close failure with empty synthetic configuration",
    "C-089": "Record Git, ripgrep, OS and libc versions", "C-090": "Verify original non-audit baseline remains unchanged",
    "C-094": "Search explicit property/snapshot and unfinished-code markers; exit 1 means no matches",
    "C-095": "Read all four CI/release/qualification workflow definitions within recorded ranges",
    "C-096": "Diagnose copied pnpm store path after user-requested retry",
    "C-097": "Verify pnpm accepts an explicit store path ending in v11",
    "C-098": "Correct only the disposable store layout and dependency metadata",
    "C-099": "Retry unchanged fresh-consumer package test after store correction",
    "C-100": "Retry full documented check with corrected private store and public registry metadata",
    "C-101": "Finish with fresh build in disposable copy", "C-102": "Verify original non-audit baseline at handback",
    "C-103": "Validate report citations, links, finding IDs and recorded source ranges",
    "C-104": "Read final bootstrap gate and clean-consumer import assertions",
    "I-001": "Attempt focused fix verification; sandbox DNS prevented Corepack setup",
    "I-002": "Run focused storage, memory, MCP and artifact regressions after sandbox retry",
    "I-003": "Run full documented check against user-authorized fixes in the working tree",
    "I-004": "Rebuild live dist after fix validation for immediate Kiro use",
    "I-005": "Compare full baseline; detect six concurrent additions from a separate audit",
    "I-006": "Validate final audit report and remediation links against the retained audit snapshot",
    "I-007": "Verify application scope while explicitly recording concurrent audit additions",
    "I-008": "Locate integration callers during user-requested Astra review",
    "I-009": "Read runtime/server integration; stop on an incorrect memory-provider path",
    "I-010": "Read corrected memory provider and remaining artifact/memory integration paths",
    "I-011": "Reproduce six newly added metadata-failure regressions before correction",
    "I-012": "Verify both bounded identity recovery fixes and related storage behavior",
    "I-013": "Run full documented check after Astra review corrections",
    "I-014": "Finish Astra review corrections with a fresh live build",
    "I-015": "Confirm final authored scope and explicitly record concurrent audit additions",
    "I-016": "Validate final report after Astra review and completed validation evidence",
    "I-017": "Check standalone commit source; symlinked dependencies caused unwanted generated path changes",
    "I-018": "Check standalone commit with local dependencies and matching generated artifacts",
    "I-019": "Finish the standalone commit with a fresh build",
    "I-020": "Validate audit report and remediation links before commit",
}

index = []
for cid, entry in sorted(commands.items()):
    command = entry.get("command", entry.get("cmd"))
    output = entry.get("output", entry.get("summary", ""))
    purpose = purposes.get(cid, "Read bounded source, callers, guards and error paths")
    index.append({
        "id": cid, "purpose": purpose, "command": command, "cwd": entry["cwd"],
        "status": entry["status"], "exit": entry.get("exit"),
        "elapsed_seconds": entry.get("elapsed_seconds"),
        "timeout_seconds": entry.get("timeout_seconds"),
        "environment": entry.get("environment", "read-only host environment or logger operation; no credential values recorded"),
        "evidence_file": cid + ".json" if (EVIDENCE / (cid + ".json")).exists() else "orientation-commands.json",
        "output_sha256": hashlib.sha256(output.encode()).hexdigest(),
    })
write("command-index.json", index)

lines = ["# Recorded command index", "", "Exact argv, cwd, limits and non-secret environment are in [command-index.json](evidence/command-index.json). Each evidence link contains the recorded output; source reads are preserved with line numbers. A logger command records the actual child argv; `audit.py` applies the stated timeout and synthetic environment. Initial read commands used the host environment. A passed command means that command completed, not that the repository passed an audit.", "", "| ID | Purpose | Status / exit | Time (s) | Evidence |", "|---|---|---|---:|---|"]
for entry in index:
    lines.append(f"| {entry['id']} | {entry['purpose']} | {entry['status']} / {entry['exit']} | {entry['elapsed_seconds'] if entry['elapsed_seconds'] is not None else 'not recorded'} | [record](evidence/{entry['evidence_file']}) |")
lines += ["", "C-003/C-006/C-009 failed during sandbox initialization; C-005/C-010/C-011 are their explicit retries. C-011's exit 2 simply establishes that the new output directory did not exist. C-025 ended with SIGTERM (-15) after dependency preparation attempted registry access; it did not execute typecheck or tests. C-048/C-052 reflect that interrupted preparation. C-058 is a reconstructed failed path lookup with no source evidence. C-056 and C-084 preserve their original failed results. On the user's retry, C-096/C-097 identified that the audit's copied store had lost its v11 suffix; pnpm therefore read an empty nested store. C-098 corrected only the disposable layout. C-099 then passed all nine unchanged package-boundary tests, and C-100 records the subsequent full check. Do not reinterpret the earlier failed commands as passed. C-094 is a no-match rg search (exit 1), not an application failure.", "", "Not run: authenticated Kiro qualification; native macOS/ARM qualification; coverage (provider absent); publish/deploy/real-home install; production MCP/OAuth calls; branch-protection inspection. No repeated stress/flakiness or exhaustive filesystem fault campaign was performed.", ""]
(OUT / "COMMAND_LOG.md").write_text("\n".join(lines))

baseline = json.loads((EVIDENCE / "baseline-manifest.json").read_text())
range_map = {}
for cid, entry in commands.items():
    if entry["status"] != "passed":
        continue
    # Read-command extraction is evidence availability, not an automatic depth claim.
    command = entry.get("command", entry.get("cmd", ""))
    if not isinstance(command, list) or "read" not in command:
        continue
    for text in entry.get("output", "").splitlines():
        match = re.match(r"^([^:]+):(\d+):", text)
        if match:
            name, number = match[1], int(match[2])
            range_map.setdefault(name, {}).setdefault(cid, []).append(number)

coverage = []
for record in baseline:
    name = record["path"]
    if record["kind"] != "file" or name.startswith(("audits/", "tobechecked/", "dist/")):
        continue
    ranges = []
    for cid, numbers in range_map.get(name, {}).items():
        ranges.append({"command": cid, "start": min(numbers), "end": max(numbers)})
    coverage.append({
        "path": name, "sha256": record["sha256"], "physical_lines": record["lines"],
        "inventory": "baseline manifest; C-007/C-015/C-016/C-059 as applicable",
        "recorded_source_reads": ranges,
        "depth": "See report component ledger; extracted ranges alone do not establish an end-to-end review",
    })
write("coverage-ledger.json", {
    "method": "All non-generated, non-prior-audit regular baseline files. Recorded line ranges are extracted from successful numbered source reads. Orientation rg/cat reads are separately in C-010/C-012/C-013/C-014; search inventory is not promoted to static tracing. Tests executed in C-056 do not imply every assertion or production path was reviewed.",
    "files": coverage,
})

write("external-sources.json", [
    {"id": "W-001", "url": "https://nodejs.org/en/about/previous-releases", "retrieved_utc_date": "2026-09-07", "local_date": "2026-09-08", "method": "web open; find v24", "result": "Node 24 is LTS; page identifies 24.20.0 as latest LTS. Node 26 is Current."},
    {"id": "W-002", "url": "https://man7.org/linux/man-pages/man2/close.2.html", "retrieved_utc_date": "2026-09-07", "local_date": "2026-09-08", "method": "web open", "result": "Linux man-pages 6.18 close(2), Dealing with error returns from close: errors may be reported after the descriptor is released; retry can close a reused descriptor. Used only to corroborate the synthetic completed-close EIO model in F-001; no reused-descriptor incident demonstrated."},
    {"id": "W-003", "url": "https://github.com/modelcontextprotocol/typescript-sdk/security/advisories/GHSA-345p-7cg4-v4c7", "retrieved_utc_date": "2026-09-07", "local_date": "2026-09-08", "method": "web open", "result": "Shared server/transport cross-client response leak; affected >=1.10.0 <=1.25.3; patched 1.26.0. Resolved direct SDK 1.30.0 is outside that range."},
    {"id": "W-004", "url": "https://github.com/modelcontextprotocol/typescript-sdk/security/advisories/GHSA-cqwc-fm46-7fff", "retrieved_utc_date": "2026-09-07", "local_date": "2026-09-08", "method": "web open; find Affected", "result": "UriTemplate ReDoS; affected <1.25.2; patched 1.25.2. Resolved direct SDK 1.30.0 is outside that range."},
    {"id": "W-005", "url": "https://github.com/modelcontextprotocol/typescript-sdk/security/advisories/GHSA-w48q-cv73-mx4w", "retrieved_utc_date": "2026-09-07", "local_date": "2026-09-08", "method": "web open; find Affected and stdio", "result": "HTTP localhost DNS-rebinding default; affected <1.24.0; patched 1.24.0. Advisory excludes stdio. Direct SDK 1.30.0 is outside affected range; inspected inbound transport is stdio."},
    {"id": "W-006", "source_command": "C-076", "retrieved_utc": "2026-09-07T22:59:27Z–2026-09-07T22:59:29Z", "local_date": "2026-09-08", "method": "Public npm /latest metadata GETs; exact ten URLs and local manifest resolutions in C-076", "result": "Latest tags and license metadata only, not maintenance/SLA assurances, exhaustive license review or automatic update recommendations."},
])

print(json.dumps({"commands": len(index), "inventoried_authored_files": len(coverage), "external_sources": 6}))
