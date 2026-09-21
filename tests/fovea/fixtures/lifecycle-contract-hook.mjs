// Development-only lifecycle recorder, never Fabric routing or model-input evidence.
import fs from 'node:fs';
import path from 'node:path';
const root = process.argv[2];
let input = '';
for await (const chunk of process.stdin) { input += chunk; if (Buffer.byteLength(input) > 65536) process.exit(4); }
const event = JSON.parse(input);
const record = row => fs.appendFileSync(path.join(root, 'hooks.jsonl'), JSON.stringify({ at: Date.now(), ...row }) + '\n', { mode: 0o600 });
const context = { trigger: event.hook_event_name, sessionId: event.session_id, prompt: event.prompt, parameterKeys: Object.keys(event) };
record({ kind: 'hook-start', ...context });
for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.once(signal, () => { record({ kind: 'hook-signal', signal, ...context }); process.exit(0); });
if (event.hook_event_name === 'UserPromptSubmit' && event.prompt?.includes('LIFECYCLE_DELAY')) await new Promise(resolve => setTimeout(resolve, 10000));
record({ kind: 'hook-end', ...context });
// Silent: no manufactured model-context delivery and no Stop continuation.
