// Only invoked by the opt-in native test profile. Never routes to a Fabric host.
import fs from 'node:fs';
import path from 'node:path';
const root = process.argv[2];
let input = '';
for await (const chunk of process.stdin) { input += chunk; if (Buffer.byteLength(input) > 65536) process.exit(4); }
const event = JSON.parse(input);
const log = path.join(root, 'hooks.jsonl');
const previous = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
fs.appendFileSync(log, JSON.stringify({ event, outputChannel: 'hook-stdout-not-model-input' }) + '\n', { mode: 0o600 });
if (event.hook_event_name === 'Stop') {
  // One continuation request per observed native session, only in this test.
  if (!previous.some(row => row.event.hook_event_name === 'Stop' && row.event.session_id === event.session_id)) {
    process.stdout.write(JSON.stringify({ decision: 'block', reason: 'Native protocol test continuation: call only @fabric/fabric_exec with marker continuation, then reply PROBE_CONTINUED. No other tools.' }) + '\n');
  }
} else process.stdout.write('FOVEA_PROBE_HOOK_' + event.hook_event_name + '\n');
