import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Type } from "typebox";
import {
  canonicalPathContains,
  inspectCanonicalPath,
  sameCanonicalFilesystemIdentity,
  type CanonicalFilesystemIdentity,
} from "../canonical-path.js";
import type { KiroPowerWorkspaceIdentity } from "./data-paths.js";

export const kiroPowerWorkspaceRequestSchema = Type.Union([
  Type.Object({ action: Type.Literal("status") }, { additionalProperties: false }),
  Type.Object({ action: Type.Literal("list") }, { additionalProperties: false }),
  Type.Object({
    action: Type.Literal("select"),
    rootId: Type.String({ minLength: 1, maxLength: 64 }),
  }, { additionalProperties: false }),
  Type.Object({
    action: Type.Literal("attach"),
    path: Type.String({ minLength: 1, maxLength: 4096 }),
  }, { additionalProperties: false }),
  Type.Object({ action: Type.Literal("detach") }, { additionalProperties: false }),
]);

export type KiroPowerWorkspaceRequest =
  | { action: "status" }
  | { action: "list" }
  | { action: "select"; rootId: string }
  | { action: "attach"; path: string }
  | { action: "detach" };

export interface KiroPowerElicitor {
  approveWorkspace(canonicalPath: string, signal?: AbortSignal): Promise<boolean>;
}

interface Candidate extends CanonicalFilesystemIdentity {
  id: string;
  root: string;
  lexicalPath: string;
  name: string;
}
interface Binding extends Candidate { source: "client-roots" | "manual" }
export type KiroPowerWorkspaceMutation =
  | { action: "select"; rootId: string }
  | { action: "attach"; root: string; dev: bigint; ino: bigint; ctimeNs: bigint }
  | { action: "detach" };

export type KiroPowerWorkspaceObservation =
  | { status: "verified"; workspace: KiroPowerBoundWorkspace }
  | { status: "unbound" }
  | { status: "temporarily-unavailable" };

export interface KiroPowerBoundWorkspace extends KiroPowerWorkspaceIdentity {
  rootId: string;
  name: string;
  source: Binding["source"];
}

const idFor = (root: string): string => createHash("sha256")
  .update("kiro-fabric-power-session-root-v1\0").update(root).digest("hex").slice(0, 16);

export class KiroPowerWorkspaceBinding {
  readonly #pluginRoot: string;
  readonly #pluginData: string;
  readonly #elicitor: KiroPowerElicitor | undefined;
  readonly #home: string;
  readonly #temporary: string;
  readonly #kiroHome: string;
  #candidates: Candidate[] = [];
  #binding: Binding | undefined;
  #initialAutoBindAllowed = true;

  constructor(options: { pluginRoot: string; pluginData: string; elicitor?: KiroPowerElicitor }) {
    this.#pluginRoot = inspectCanonicalPath(options.pluginRoot, {
      kind: "directory",
      rejectFinalSymlink: true,
    }).canonicalPath;
    this.#pluginData = inspectCanonicalPath(options.pluginData, {
      kind: "directory",
      rejectFinalSymlink: true,
    }).canonicalPath;
    this.#elicitor = options.elicitor;
    this.#home = inspectCanonicalPath(os.homedir(), { kind: "directory" }).canonicalPath;
    this.#temporary = inspectCanonicalPath(os.tmpdir(), { kind: "directory" }).canonicalPath;
    const kiroHome = path.join(this.#home, ".kiro");
    this.#kiroHome = existsSync(kiroHome)
      ? inspectCanonicalPath(kiroHome, { kind: "directory" }).canonicalPath
      : kiroHome;
  }

  #canonical(candidate: string): Candidate {
    if (!path.isAbsolute(candidate)) throw new Error("workspace root must be absolute");
    const inspected = inspectCanonicalPath(candidate, {
      kind: "directory",
      rejectFinalSymlink: true,
    });
    const root = inspected.canonicalPath;
    const currentKiroHome = existsSync(this.#kiroHome)
      ? inspectCanonicalPath(this.#kiroHome, { kind: "directory" }).canonicalPath
      : this.#kiroHome;
    const insideKiroHome = canonicalPathContains(currentKiroHome, root);
    const unsafe = [path.parse(root).root, this.#home, this.#temporary, this.#pluginRoot, this.#pluginData];
    if (unsafe.includes(root) || insideKiroHome || canonicalPathContains(root, this.#home)) {
      throw new Error("workspace root is too broad or reserved");
    }
    for (const reserved of [this.#pluginRoot, this.#pluginData]) {
      if (canonicalPathContains(reserved, root) || canonicalPathContains(root, reserved)) {
        throw new Error("workspace root and plugin storage must not contain one another");
      }
    }
    return {
      id: idFor(root),
      root,
      lexicalPath: inspected.lexicalPath,
      name: path.basename(root) || "workspace",
      ...inspected.identity,
    };
  }

  updateClientRoots(roots: readonly { uri: string; name?: string | undefined }[]): void {
    const candidates: Candidate[] = [];
    const advertisedCanonicalRoots = new Set<string>();
    for (const item of roots) {
      let advertised: string | undefined;
      try {
        if (!item.uri.startsWith("file:")) continue;
        advertised = path.resolve(fileURLToPath(item.uri));
        const candidate = this.#canonical(advertised);
        advertisedCanonicalRoots.add(candidate.root);
        candidates.push({ ...candidate, name: (item.name?.trim() || candidate.name).slice(0, 120) });
      } catch {
        // Preserve an already-bound alias as temporarily unavailable when the
        // client still advertises the same lexical spelling. Failure to inspect
        // it (including EPERM) is not evidence that the root was removed.
        if (advertised && this.#binding?.lexicalPath === advertised) {
          advertisedCanonicalRoots.add(this.#binding.root);
        }
      }
    }
    this.#candidates = [...new Map(candidates.map((entry) => [entry.id, entry])).values()];
    if (this.#binding?.source === "client-roots") {
      const current = this.#candidates.find((entry) => entry.id === this.#binding!.id);
      // An advertised path that cannot currently be inspected is not evidence
      // that the client removed it. Retain the binding but fail closed through
      // workspaceObservation() until local verification recovers.
      const transient = advertisedCanonicalRoots.has(this.#binding.root) && !current;
      if (!transient && (!current || current.dev !== this.#binding.dev || current.ino !== this.#binding.ino)) {
        this.#binding = undefined;
        this.#initialAutoBindAllowed = false;
      }
    }
    if (this.#candidates.length > 1) this.#initialAutoBindAllowed = false;
    if (!this.#binding && this.#initialAutoBindAllowed && this.#candidates.length === 1) {
      this.#binding = { ...this.#candidates[0]!, source: "client-roots" };
      this.#initialAutoBindAllowed = false;
    }
  }

  bindingIdentity(): string {
    const binding = this.#binding;
    return binding ? `${binding.root}\0${binding.dev}\0${binding.ino}` : "<unbound>";
  }

  bindingSource(): Binding["source"] | undefined {
    return this.#binding?.source;
  }

  workspaceObservation(): KiroPowerWorkspaceObservation {
    const binding = this.#binding;
    if (!binding) return { status: "unbound" };
    // A client-root binding remains authorized only while the client-advertised
    // lexical path can still be resolved to the same candidate. Verifying the
    // old canonical path alone would incorrectly preserve access after an
    // advertised parent alias became unavailable.
    if (binding.source === "client-roots") {
      const advertised = this.#candidates.find((entry) => entry.id === binding.id);
      if (!advertised || !sameCanonicalFilesystemIdentity(advertised, binding)) {
        return { status: "temporarily-unavailable" };
      }
    }
    try {
      const current = this.#canonical(binding.root);
      if (!sameCanonicalFilesystemIdentity(current, binding)) {
        return { status: "temporarily-unavailable" };
      }
      return {
        status: "verified",
        workspace: Object.freeze({
          schemaVersion: 1,
          canonicalPath: binding.root,
          deviceId: binding.dev.toString(),
          fileId: binding.ino.toString(),
          rootId: binding.id,
          name: binding.name,
          source: binding.source,
        }),
      };
    } catch {
      // Observation is deliberately non-destructive. A transient filesystem
      // failure must not turn status/list into an implicit detach operation.
      return { status: "temporarily-unavailable" };
    }
  }

  boundWorkspace(): KiroPowerBoundWorkspace | undefined {
    const observation = this.workspaceObservation();
    return observation.status === "verified" ? observation.workspace : undefined;
  }

  boundRoot(): string | undefined {
    return this.boundWorkspace()?.canonicalPath;
  }

  status() {
    const workspace = this.boundWorkspace();
    return workspace
      ? { status: "bound" as const, rootId: workspace.rootId, name: workspace.name, source: workspace.source }
      : { status: "unbound" as const, requiresSelection: this.#candidates.length > 1 };
  }

  list() { return { ...this.status(), roots: this.#candidates.map(({ id, name }) => ({ rootId: id, name })) }; }

  async prepareMutation(
    request: Extract<KiroPowerWorkspaceRequest, { action: "select" | "attach" | "detach" }>,
    signal?: AbortSignal,
  ): Promise<KiroPowerWorkspaceMutation> {
    if (request.action === "detach") return request;
    if (request.action === "select") {
      if (!this.#candidates.some((entry) => entry.id === request.rootId)) {
        throw new Error("unknown workspace rootId; call fabric_workspace list first");
      }
      return request;
    }
    const candidate = this.#canonical(request.path);
    if (candidate.ctimeNs === undefined) {
      throw new Error("workspace root identity cannot be verified for approval");
    }
    if (!this.#elicitor) throw new Error("manual workspace attachment requires MCP elicitation support");
    signal?.throwIfAborted();
    const approved = await this.#elicitor.approveWorkspace(candidate.root, signal);
    signal?.throwIfAborted();
    if (!approved) throw new Error("manual workspace attachment was not approved");
    // Bind approval to the exact filesystem object that was presented. The
    // pathname alone is insufficient because it can be replaced while the
    // elicitation dialog is open.
    const approvedIdentity = inspectCanonicalPath(candidate.root, {
      kind: "directory",
      rejectFinalSymlink: true,
    });
    if (!sameCanonicalFilesystemIdentity(approvedIdentity.identity, candidate, { includeCtime: true })) {
      throw new Error("workspace root identity changed during approval; attach and approve again");
    }
    // ctime cannot be restored by an unprivileged pathname swap. Carry it to
    // commit so an inode deleted and recycled after approval cannot satisfy a
    // dev/inode-only comparison.
    return {
      action: "attach",
      root: candidate.root,
      dev: candidate.dev,
      ino: candidate.ino,
      ctimeNs: candidate.ctimeNs!,
    };
  }

  commitMutation(mutation: KiroPowerWorkspaceMutation): ReturnType<KiroPowerWorkspaceBinding["status"]> {
    if (mutation.action === "detach") {
      this.#binding = undefined;
    } else if (mutation.action === "select") {
      const candidate = this.#candidates.find((entry) => entry.id === mutation.rootId);
      if (!candidate) throw new Error("workspace root selection changed while the request was pending; list and retry");
      const current = this.#canonical(candidate.root);
      if (!sameCanonicalFilesystemIdentity(current, candidate)) {
        throw new Error("workspace root identity changed while the request was pending; list and retry");
      }
      this.#binding = { ...candidate, source: "client-roots" };
    } else {
      const candidate = this.#canonical(mutation.root);
      const approvedIdentity = inspectCanonicalPath(candidate.root, {
        kind: "directory",
        rejectFinalSymlink: true,
      });
      if (
        candidate.dev !== mutation.dev || candidate.ino !== mutation.ino ||
        approvedIdentity.identity.ctimeNs === undefined ||
        approvedIdentity.identity.ctimeNs !== mutation.ctimeNs
      ) {
        throw new Error("workspace root identity changed after approval; attach and approve again");
      }
      this.#binding = { ...candidate, source: "manual" };
    }
    this.#initialAutoBindAllowed = false;
    return this.status();
  }

  async handle(request: KiroPowerWorkspaceRequest, signal?: AbortSignal) {
    if (request.action === "status") return this.status();
    if (request.action === "list") return this.list();
    return this.commitMutation(await this.prepareMutation(request, signal));
  }
}
