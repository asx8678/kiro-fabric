// Generic bootstrap for a blinded benchmark candidate. The controller sends a
// single JSON treatment document on stdin. It is retained only in this Pi
// process (never in argv, the environment, or the sandbox filesystem).
import fs from "node:fs";

const boundarySymbol = Symbol.for("kiro-fabric.benchmark-boundary.v1");
const maximumBytes = 16 * 1024;
let input = Buffer.alloc(0);
const chunk = Buffer.alloc(4096);
while (input.length <= maximumBytes) {
  const count = fs.readSync(0, chunk, 0, chunk.length, null);
  if (count === 0) break;
  input = Buffer.concat([input, chunk.subarray(0, count)]);
}
if (input.length === 0 || input.length > maximumBytes) {
  throw new Error("invalid blinded treatment channel");
}
const document = JSON.parse(input.toString("utf8"));
if (document === null || Array.isArray(document) || typeof document !== "object") {
  throw new Error("invalid blinded treatment document");
}

// The generic inner launcher duplicated the socket endpoint to fd 3 before
// Node started. Replace stdin after consuming it; the controller half-closed
// its write side, so later fd-3 reads cannot recover treatment bytes.
const telemetryFd = 3;
try { fs.closeSync(0); } catch {}
fs.openSync("/dev/null", "r");

Object.defineProperty(globalThis, boundarySymbol, {
  configurable: false,
  enumerable: false,
  writable: false,
  value: Object.freeze({
    document: structuredClone(document),
    emit(event) {
      const line = `${JSON.stringify(event)}\n`;
      fs.writeSync(telemetryFd, line, null, "utf8");
    },
  }),
});
