import fs from "node:fs";
import { randomBytes, createHash } from "node:crypto";
import path from "node:path";

export interface FoveaBindingAuthority { canonicalPath: string; deviceId: string; fileId: string; conversationId: string; conversationEpoch: number; authorizationEpoch: number }
export interface FoveaLease extends FoveaBindingAuthority { rootId: string; worktreeId: string; scopeDigest: string; signal: AbortSignal }
/** Only the MCP binding authority calls issue. Neither cached metadata nor paths
 * supplied to repo.* reach this constructor as grants. */
export class FoveaRootLeases {
  readonly #leases = new Map<string, { lease: FoveaLease; controller: AbortController }>();
  issue(authority: FoveaBindingAuthority): FoveaLease {
    if (this.#leases.size >= 32) throw new Error("Fovea authorized root limit reached");
    this.#verify(authority);
    const controller = new AbortController(), rootId = `root_${randomBytes(16).toString("hex")}`;
    const worktreeId = createHash("sha256").update(`${authority.canonicalPath}\0${authority.deviceId}\0${authority.fileId}`).digest("hex");
    const lease = Object.freeze({ ...authority, rootId, worktreeId, scopeDigest: createHash("sha256").update(`fovea-whole-root-v1\0${worktreeId}`).digest("hex"), signal: controller.signal });
    this.#leases.set(rootId, { lease, controller }); return lease;
  }
  check(lease: FoveaLease, requestedRoot?: unknown): void {
    if (requestedRoot !== undefined && requestedRoot !== lease.rootId) throw new Error("repo rootId does not select this authorized binding");
    if (this.#leases.get(lease.rootId)?.lease !== lease || lease.signal.aborted) throw new Error("Fovea binding revoked");
    this.#verify(lease);
  }
  revoke(lease: FoveaLease): void { const entry = this.#leases.get(lease.rootId); if (entry?.lease === lease) { entry.controller.abort(new Error("Fovea binding revoked")); this.#leases.delete(lease.rootId); } }
  close(): void { for (const entry of this.#leases.values()) entry.controller.abort(new Error("Fovea host closed")); this.#leases.clear(); }
  #verify(a: FoveaBindingAuthority): void {
    if (!path.isAbsolute(a.canonicalPath) || path.resolve(a.canonicalPath) !== a.canonicalPath || fs.realpathSync(a.canonicalPath) !== a.canonicalPath || !/^[a-zA-Z0-9_-]{1,100}$/u.test(a.conversationId) || !Number.isSafeInteger(a.conversationEpoch) || a.conversationEpoch < 0 || !Number.isSafeInteger(a.authorizationEpoch) || a.authorizationEpoch < 0) throw new Error("Invalid host analysis authority");
    const s = fs.lstatSync(a.canonicalPath, { bigint: true });
    if (!s.isDirectory() || s.isSymbolicLink() || String(s.dev) !== a.deviceId || String(s.ino) !== a.fileId) throw new Error("Fovea authorized filesystem identity changed");
  }
}
