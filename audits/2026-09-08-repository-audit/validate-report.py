#!/usr/bin/env python3
"""Check audit artifact consistency; no repository application writes."""
import hashlib
import json
import pathlib
import re
import sys

out = pathlib.Path(__file__).resolve().parent
evidence = out / 'evidence'
report_path = out / 'REPOSITORY_AUDIT.md'
report = report_path.read_text()
snapshot = pathlib.Path(json.loads((evidence / 'snapshot.json').read_text())['checkout'])
manifest = {r['path']: r for r in json.loads((evidence / 'baseline-manifest.json').read_text())}
pending = sys.argv[1] if len(sys.argv) > 1 else None
errors = []
warnings = []

commands = {c['id']: c for c in json.loads((evidence / 'orientation-commands.json').read_text())}
for file in evidence.glob('C-*.json'):
    command = json.loads(file.read_text())
    commands[command['id']] = command

citations = []
pattern = r'(?<![A-Za-z0-9_./-])([A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)*\.(?:ts|mjs|json|md|yml|yaml|sh)):(\d+)(?:-(\d+))?'
for match in re.finditer(pattern, report):
    name, start, end = match[1], int(match[2]), int(match[3] or match[2])
    record = manifest.get(name)
    valid = record is not None and record['kind'] == 'file' and 1 <= start <= end <= record['lines']
    if not valid:
        errors.append({'type': 'invalid_source_range', 'citation': match[0], 'available_lines': record.get('lines') if record else None})
    elif not (snapshot / name).exists():
        errors.append({'type': 'missing_snapshot_source', 'path': name})
    elif name.startswith(('src/', 'scripts/', 'tests/', 'docs/', '.github/')) and hashlib.sha256((snapshot / name).read_bytes()).hexdigest() != record['sha256']:
        errors.append({'type': 'snapshot_source_changed', 'path': name})
    citations.append({'path': name, 'start': start, 'end': end})

command_refs = set(re.findall(r'\bC-\d{3}\b', report))
for command in sorted(command_refs):
    if command not in commands and command != pending:
        errors.append({'type': 'missing_command', 'id': command})

links = []
for match in re.finditer(r'\[[^\]\n]+\]\(([^)\n]+)\)', report):
    target = match[1]
    if target.startswith(('https://', 'http://', '#')):
        continue
    file = out / target.split('#', 1)[0]
    if not file.exists() and target != f'evidence/{pending}.json':
        errors.append({'type': 'missing_local_link', 'target': target})
    links.append(target)

headers = re.findall(r'^## (\d+)\. ', report, flags=re.M)
if headers != [str(i) for i in range(1, 12)]:
    errors.append({'type': 'section_structure', 'headers': headers})
findings = re.findall(r'^#### (F-\d{3}) —', report, flags=re.M)
if findings != ['F-001', 'F-002']:
    errors.append({'type': 'finding_register', 'headers': findings})
unknown_findings = set(re.findall(r'\bF-\d{3}\b', report)) - set(findings)
if unknown_findings:
    errors.append({'type': 'undefined_finding', 'ids': sorted(unknown_findings)})

allowed_statuses = {
    'Verified within tested scope', 'Statically traced only', 'Partially verified',
    'Confirmed defect', 'Not verified', 'Not applicable',
}
feature_rows = []
for row in report.splitlines():
    if not row.startswith('| FV-'):
        continue
    cells = [c.strip() for c in row.split('|')[1:-1]]
    if len(cells) != 7 or cells[4] not in allowed_statuses:
        errors.append({'type': 'feature_matrix_schema', 'row_start': row[:80]})
    feature_rows.append(cells[0])

# Screening only: do not print possible values. Most residual privacy checks
# (identifying real versus synthetic data) require the author's review.
secret_patterns = {
    'private_key_header': r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----',
    'github_token': r'\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b',
    'aws_access_key': r'\b(?:AKIA|ASIA)[A-Z0-9]{16}\b',
    'slack_token': r'\bxox[baprs]-[A-Za-z0-9-]{20,}\b',
}
redaction_candidates = []
for file in out.rglob('*'):
    if not file.is_file() or file.suffix not in ('.md', '.json', '.py', '.mjs', '.cjs'):
        continue
    text = file.read_text()
    for kind, expression in secret_patterns.items():
        for match in re.finditer(expression, text):
            redaction_candidates.append({'path': str(file.relative_to(out)), 'kind': kind, 'line': text.count('\n', 0, match.start()) + 1})
if redaction_candidates:
    errors.append({'type': 'redaction_screen_requires_review', 'locations': redaction_candidates})

result = {
    'ok': not errors,
    'report_sha256': hashlib.sha256(report.encode()).hexdigest(),
    'word_count_approximate': len(report.split()),
    'numbered_sections': len(headers),
    'source_citations': len(citations),
    'unique_source_files_cited': len(set(x['path'] for x in citations)),
    'command_references': len(command_refs),
    'local_links': len(links),
    'findings': findings,
    'feature_rows': len(feature_rows),
    'redaction_screen_candidates': redaction_candidates,
    'pending_wrapper_record': pending,
    'method': 'Source paths/ranges checked against pre-audit manifest and snapshot bytes; command IDs and local links checked; pending wrapper record is written after this command returns. Finding headings and feature statuses checked. High-specificity redaction screening, not exhaustive privacy detection. No semantic truth or coverage percentage is inferred.',
    'errors': errors, 'warnings': warnings,
}
(evidence / 'report-validation.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(result, indent=2))
sys.exit(0 if result['ok'] else 1)
