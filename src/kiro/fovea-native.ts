/** Production status, not client qualification. Native hooks may fire while
 * automatic Fovea stays disabled: MCP has no supported native session identity. */
export interface FoveaHookCapability {
  schemaVersion: 1;
  status: "host-blocked";
  reason: "native-session-rendezvous-unavailable";
  dispatched: false;
  automatic: false;
  modelContextDelivered: false;
}

export function foveaHookCapability(): FoveaHookCapability {
  return { schemaVersion: 1, status: "host-blocked", reason: "native-session-rendezvous-unavailable", dispatched: false, automatic: false, modelContextDelivered: false };
}
