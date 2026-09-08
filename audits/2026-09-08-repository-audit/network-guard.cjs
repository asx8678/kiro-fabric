// Audit artifact: defense in depth against accidental non-loopback Node network calls.
// Not an OS sandbox and not evidence of application egress security.
const net = require("node:net");
const originalConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const arg = args[0];
  const host = arg && typeof arg === "object" ? arg.host : (typeof args[1] === "string" ? args[1] : "localhost");
  const socketPath = arg && typeof arg === "object" ? arg.path : (typeof arg === "string" && !/^\d+$/.test(arg) ? arg : undefined);
  if (socketPath && !socketPath.startsWith("/tmp/")) throw new Error("AUDIT_NETWORK_GUARD: non-temporary socket blocked");
  if (!socketPath && host && !["localhost", "127.0.0.1", "::1"].includes(host)) throw new Error("AUDIT_NETWORK_GUARD: non-loopback network blocked");
  return originalConnect.apply(this, args);
};
const originalFetch = globalThis.fetch;
if (originalFetch) globalThis.fetch = (input, init) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("AUDIT_NETWORK_GUARD: non-loopback fetch blocked");
  return originalFetch(input, init);
};
