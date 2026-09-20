// Short-lived native hook entry. No engine, credentials, cwd-based session
// guessing, private RPC, or filesystem rendezvous is permitted here.
import path from "node:path";
import { pathToFileURL } from "node:url";

export interface FoveaHookCapability {
  schemaVersion: 1;
  status: "host-blocked";
  reason: "native-session-rendezvous-unavailable";
  dispatched: false;
}

export function foveaHookCapability(): FoveaHookCapability {
  return { schemaVersion: 1, status: "host-blocked", reason: "native-session-rendezvous-unavailable", dispatched: false };
}

// Deliberately does not consume stdin or user-controlled hook payloads: there
// is no qualified native session association to route them to. Status is not
// supplementary model context or proof that a hook fired in the native client.
export function runFoveaHook(): number {
  process.stdout.write(JSON.stringify(foveaHookCapability()) + "\n");
  return 3;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = runFoveaHook();
}
