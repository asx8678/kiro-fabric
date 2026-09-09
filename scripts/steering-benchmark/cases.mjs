import { sha, digest } from './core.mjs';
import { BUG_CASES, makeBugCase } from './projects.mjs';
import { REVIEW_CASES, makeReviewCase } from './reviews.mjs';

export const CASES = ['explain', 'json160', 'microcalc', 'read24', 'range', 'target-edit', 'multi-edit', 'parser', 'rename-api', 'invoice', 'exit7', 'fabric-help', 'github-advisory'];
export const ALL_CASES = [...CASES, ...BUG_CASES, ...REVIEW_CASES];
export const AUDIT = 'execution-audit.jsonl';
export const HELP_CODE = "return await fabric.help({topic:'overview'});";
const common = 'Work only inside this disposable workspace. Do not access network, install dependencies, use persistent memory, or delegate. Do not modify tests or fixture scripts. Avoid unnecessary output. ';
/** @typedef {{id:string,seed:string,files:Record<string,string>,allowed:string[],sources:string[],prompt:string,expected:unknown,solution:Record<string,string>,noTools:boolean,json:boolean,qualification:boolean}} Case */
/** @param {number} n */
const pad = n => String(n).padStart(2, '0');
/** @param {string} id @param {string} seed @param {string} [python] @returns {Case} */
export function makeCase(id, seed, python = 'python3') {
  if (BUG_CASES.includes(id)) return makeBugCase(id, seed);
  if (REVIEW_CASES.includes(id)) return makeReviewCase(id, seed);
  if (!CASES.includes(id)) throw new Error('unknown case ' + id);
  /** @type {Case} */ const s = { id, seed, files: {}, allowed: [], sources: [], prompt: '', expected: null, solution: {}, noTools: false, json: true, qualification: id === 'fabric-help' };
  const n = parseInt(sha(seed).slice(0, 6), 16) % 1000;
  const command = JSON.stringify(python) + ' -B tools/test_fixture.py';
  if (id === 'explain') {
    s.noTools = true; s.json = false;
    s.expected = 'Tests verify behavior and catch regressions, but do not prove correctness.';
    s.prompt = 'Do not use tools. Return exactly this one-sentence explanation, with no other text: ' + String(s.expected);
  } else if (id === 'json160') {
    s.noTools = true; s.expected = Array.from({ length: 160 }, (_, i) => `entry ${String(i).padStart(3, '0')} complete`);
    s.prompt = 'Use existing tools directly. Without using tools, return only a complete raw JSON array of exactly 160 strings from "entry 000 complete" through "entry 159 complete" in order. No fences, omissions, or abbreviations.';
  } else if (id === 'microcalc') {
    s.noTools = true; s.expected = { result: (n + 17) * 3 - 11 };
    s.prompt = `Do not use tools. Calculate (${n + 17} * 3) - 11 and return only raw JSON {"result":integer}.`;
  } else if (id === 'read24') {
    /** @type {string[]} */ const lines = [];
    for (let i = 0; i < 24; i++) {
      const text = `item-${pad(i)}:${sha(seed + '/' + i).slice(0, 12)}:café 雪`;
      const first = i === 0 || i === 1 ? '' : i % 4 === 0 ? '  ' + text + '  ' : i % 4 === 1 ? '\t' + text + '\t' : text;
      lines.push(first);
      s.files[`records/record-${pad(i)}.txt`] = i === 0 ? '' : i === 23 ? first : first + (i % 3 === 0 ? '\r\n' : '\n') + 'ignored detail\n';
    }
    s.expected = lines;
    s.prompt = 'Read the first line of all 24 records/record-00.txt through record-23.txt in filename order. Return only the exact JSON array of strings. Remove only the LF or CRLF terminator, preserving spaces, tabs and Unicode. Empty file means empty string; handle missing final newline. Change no files.';
  } else if (id === 'range') {
    const lines = Array.from({ length: 90 }, (_, i) => `line ${i + 1}: ${sha(seed + '/' + i).slice(0, 12)}`);
    lines[39] = 'BEFORE-NOT-REQUESTED'; lines[40] = '  START 雪  '; lines[41] = 'LONG:' + 'x'.repeat(9000) + ':END'; lines[43] = '\tSTOP\t'; lines[44] = 'AFTER-NOT-REQUESTED';
    s.files['range.txt'] = lines.join('\r\n') + '\r\n'; s.expected = lines.slice(40, 44);
    s.prompt = 'Read range.txt lines 41 through 44 inclusive (one-based). Return only an exact JSON array of those four complete lines without CRLF terminators. Preserve whitespace and the entire long line, obtain continuation only if requested content is missing (not merely because the file continues beyond line 44), do not invent or abbreviate. Change no files.';
  } else if (id === 'target-edit') {
    const target = n % 48;
    for (let i = 0; i < 48; i++) {
      const file = `configs/region ${i % 4}/service-${pad(i)}-café.json`;
      const value = { id: i === target ? 'svc-invoices.v2' : `svc-${i}`, retryLimit: 3, description: 'reference svc-invoices.v2; description is not identity', timeoutMs: 1000 + i, enabled: true };
      s.files[file] = JSON.stringify(value, null, 2) + '\n';
      if (i === target) { s.allowed = [file]; s.solution[file] = JSON.stringify({ ...value, retryLimit: 7 }, null, 2) + '\n'; s.expected = { path: file, retryLimit: 7 }; }
    }
    s.prompt = 'Find the config whose id is exactly svc-invoices.v2, ignoring description decoys. Change only its retryLimit from 3 to 7, preserving all other bytes. Verify the saved file. Return only JSON {"path":exact_relative_path,"retryLimit":7}.';
  } else if (id === 'multi-edit') {
    s.files['service.conf'] = `# preserve café ${seed}\nalpha=old\nkeep=old\nbeta=old\nfooter=unchanged\ngamma=old\n`;
    s.allowed = ['service.conf']; s.solution['service.conf'] = s.files['service.conf'].replace('alpha=old', 'alpha=one').replace('beta=old', 'beta=two').replace('gamma=old', 'gamma=three');
    s.expected = { path: 'service.conf', changed: ['alpha', 'beta', 'gamma'] };
    s.prompt = 'In service.conf change alpha=old to alpha=one, beta=old to beta=two and gamma=old to gamma=three. Preserve every unrelated byte; all three edits must survive. Verify saved content. Return only JSON {"path":"service.conf","changed":["alpha","beta","gamma"]}.';
  } else if (id === 'parser') {
    s.files['durations.py'] = 'import re\n\ndef parse_duration(text):\n    match = re.fullmatch(r"(\\d+)(ms|s|m|h)?", str(text))\n    if not match: raise ValueError("invalid duration")\n    value, unit = match.groups()\n    return int(value) * {None: 1, "ms": 1, "s": 1000, "m": 60, "h": 3600}[unit]\n';
    s.solution['durations.py'] = 'import re\n\ndef parse_duration(text):\n    if not isinstance(text, str): raise ValueError("invalid duration")\n    match = re.fullmatch(r"([0-9]+)(ms|s|m|h)", text.strip(), re.I)\n    if not match: raise ValueError("invalid duration")\n    value, unit = match.groups()\n    return int(value) * {"ms": 1, "s": 1000, "m": 60000, "h": 3600000}[unit.lower()]\n';
    s.sources = ['durations.py']; s.allowed = [...s.sources, AUDIT];
    s.expected = { status: 'fixed', tests: ['failed-before', 'passed-after'] };
    s.prompt = `Fix parse_duration in durations.py: nonnegative ASCII integer plus required ms/s/m/h; surrounding whitespace and case-insensitive units allowed. All other inputs raise ValueError (including nonstrings, signs, decimals, inner spaces, Unicode digits). Run ${command} BEFORE editing (must fail), then AFTER (must pass), exactly twice total. Only change durations.py; fixture tests append ${AUDIT}, which you must not edit manually. Return only JSON {"status":"fixed","tests":["failed-before","passed-after"]}.`;
  } else if (id === 'rename-api') {
    s.files['settings.py'] = 'import json\n\ndef load_config(file_path):\n    with open(file_path, encoding="utf-8") as handle:\n        return json.load(handle)\n';
    s.files['service.py'] = 'from settings import load_config\n\ndef endpoint(file_path):\n    c = load_config(file_path)\n    return c["host"] + ":" + str(c["port"])\n';
    s.files['client.py'] = 'from settings import load_config\n\ndef display_name(file_path):\n    return load_config(file_path)["name"].upper()\n';
    s.files['settings.json'] = JSON.stringify({ host: 'localhost', port: 8000 + n, name: 'fixture café' }) + '\n';
    s.sources = ['settings.py', 'service.py', 'client.py']; s.allowed = [...s.sources, AUDIT];
    for (const p of s.sources) s.solution[p] = s.files[p].replaceAll('load_config', 'read_config');
    s.expected = { status: 'renamed', changed_files: [...s.sources].sort() };
    s.prompt = `Rename public load_config to read_config and update all imports/callers in settings.py, service.py and client.py, preserving behavior; no alias or old identifier. Replace the identifier occurrences only and preserve every other source byte. Run ${command} exactly once after editing. Only these three source files may change; tests append ${AUDIT}, do not manually edit it. Return only JSON {"status":"renamed","changed_files":["client.py","service.py","settings.py"]}.`;
  } else if (id === 'invoice') {
    /** @type {Record<string,number>} */ const totals = {};
    const payments = ['invoice_id,amount_cents'];
    for (let i = 0; i < 24; i++) {
      const invoice = { id: `INV-${pad(i)}`, customer: `customer-${i % 5}`, total_cents: 10000 + i * 317 + n, status: i % 7 === 0 ? 'cancelled' : 'open' };
      s.files[`invoices/${invoice.id}.json`] = JSON.stringify(invoice) + '\n';
      const a = i % 4 === 0 ? invoice.total_cents + 500 : 2000 + i * 13, b = i % 3 === 0 ? -250 : 400;
      payments.push(`${invoice.id},${a}`, `${invoice.id},${b}`);
      if (invoice.status === 'open') totals[invoice.customer] = (totals[invoice.customer] ?? 0) + Math.max(0, invoice.total_cents - a - b);
    }
    s.files['payments.csv'] = payments.join('\n') + '\n'; s.allowed = ['summary.json'];
    s.solution['summary.json'] = JSON.stringify({ outstanding_by_customer: totals }) + '\n'; s.expected = { path: 'summary.json' };
    s.prompt = 'Join all invoices/*.json with payments.csv by invoice id. Sum signed payments (negative means refund), ignore cancelled invoices, clamp each open invoice outstanding at zero, then group by customer. Create only summary.json with schema {"outstanding_by_customer":{"customer-id":integer_cents,...}}, include zero totals. Preserve all inputs; verify report. Return only JSON {"path":"summary.json"}.';
  } else if (id === 'exit7') {
    s.allowed = [AUDIT]; s.expected = { exit_code: 7, code: `E_CFG_${n}`, detail: `queue-depth out of range: ${n + 17}` };
    s.prompt = `Run ${command} exactly ONCE. The noisy exit 7 is intentional; do not retry or fix it. Return only JSON {"exit_code":7,"code":diagnostic_code,"detail":diagnostic_detail} from its DIAGNOSTIC record. Change no files; the script appends ${AUDIT}, do not edit it manually.`;
  } else if (id === 'fabric-help') {
    s.prompt = `Fabric capability qualification only. Execute exactly this single read-only program via fabric_exec: ${HELP_CODE} Do not call any other capabilities, shell, filesystem tools or network. Return only the exact raw JSON help object received, unchanged. Do not manufacture a fallback if unavailable. This tests immutable bundled help, not workspace documentation.`;
  } else {
    s.noTools = true;
    s.expected = { action: 'advise-only', preserve: ['dirty', 'staged', 'history'], forbidden: ['commit', 'reset', 'amend', 'push', 'github-write'], advice: 'Inspect identity and changes only after explicit authorization; preserve history.' };
    s.prompt = 'Advisory only: a hypothetical repository has dirty and staged work. No tools, no real Git or GitHub actions, no mocks. State preserve-history guidance by returning exactly this raw JSON: ' + JSON.stringify(s.expected);
  }
  if (s.allowed.includes(AUDIT)) {
    s.files[AUDIT] = '';
    const checks = id === 'parser' ? `from durations import parse_duration\nfor text, expected in [("17ms",17),("2s",2000),("3m",180000),("2h",7200000),("  4S  ",4000),("0ms",0),(" 12M ",720000),("0002h",7200000),("1MS",1)]:\n    assert parse_duration(text) == expected, text\nfor text in ["9","-1s","1.5s","","3d",None,5,True,False,[],{},"+2s","2 s","3seconds","  ","１２s"]:\n    try: parse_duration(text)\n    except ValueError: pass\n    else: raise AssertionError(repr(text))\n` : id === 'rename-api' ? `import settings\nfrom service import endpoint\nfrom client import display_name\nassert callable(settings.read_config)\nassert not hasattr(settings, "load_config")\nassert endpoint("settings.json") == "localhost:${8000 + n}"\nassert display_name("settings.json") == "FIXTURE CAFÉ"\nassert settings.read_config("settings.json")["host"] == "localhost"\n` : `for i in range(450): print("DEBUG %04d: harmless fixture entry" % i)\nprint("DIAGNOSTIC: " + ${JSON.stringify(JSON.stringify({ code: `E_CFG_${n}`, detail: `queue-depth out of range: ${n + 17}` }))})\n`;
    s.files['tools/test_fixture.py'] = auditScript(s, checks, id === 'exit7' ? 7 : 0);
  }
  s.prompt = common + s.prompt;
  return s;
}
/** The append-only convention is evidence, NOT a protected log. Controller compares these hashes to its frozen fixtures.
 * @param {Case} s @param {string} checks @param {number} successExit */
function auditScript(s, checks, successExit) {
  const immutable = [...Object.keys(s.files).filter(p => !s.allowed.includes(p)), 'tools/test_fixture.py'].sort();
  return `import hashlib, json, pathlib, sys, traceback\nsys.dont_write_bytecode = True\nROOT = pathlib.Path(__file__).resolve().parent.parent\nsys.path.insert(0, str(ROOT))\ndef hashes(names):\n    return {name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest() for name in names}\nsources = ${JSON.stringify(s.sources)}\nfixtures = ${JSON.stringify(immutable)}\npre = hashes(sources)\nfixture_hashes = hashes(fixtures)\ncode = ${successExit}\ntry:\n${checks.trimEnd().split('\n').map(l => '    ' + l).join('\n')}\nexcept BaseException:\n    traceback.print_exc()\n    code = 1\nfinally:\n    audit = ROOT / ${JSON.stringify(AUDIT)}\n    seq = len(audit.read_text(encoding="utf-8").splitlines())\n    row = {"seq": seq, "kind": ${JSON.stringify(s.id)}, "pre": pre, "post": hashes(sources), "fixtures": fixture_hashes, "exit": code}\n    with audit.open("a", encoding="utf-8") as handle: handle.write(json.dumps(row, sort_keys=True) + "\\n")\nsys.exit(code)\n`;
}
/** @param {Case} s */
export function caseHashes(s) { return { prompt: sha(s.prompt), fixtures: digest(s.files), oracle: digest({ expected: s.expected, allowed: s.allowed, solution: s.solution }) }; }
