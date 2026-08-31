import { createHash } from "node:crypto";
import { lstatSync, realpathSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Type } from "typebox";
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

interface Candidate { id: string; root: string; name: string; dev: bigint; ino: bigint }
interface Binding extends Candidate { source: "client-roots" | "manual" }
export type KiroPowerWorkspaceMutation =
  | { action: "select"; rootId: string }
  | { action: "attach"; root: string }
  | { action: "detach" };

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
  #candidates: Candidate[] = [];
  #binding: Binding | undefined;
  #initialAutoBindAllowed = true;

  constructor(options: { pluginRoot: string; pluginData: string; elicitor?: KiroPowerElicitor }) {
    this.#pluginRoot = options.pluginRoot;
    this.#pluginData = options.pluginData;
    this.#elicitor = options.elicitor;
  }

  #canonical(candidate: string): Candidate {
    if (!path.isAbsolute(candidate)) throw new Error("workspace root must be absolute");
    const resolved = path.resolve(candidate);
    const lexical = lstatSync(resolved);
    const root = realpathSync(resolved);
    if (lexical.isSymbolicLink() || root !== resolved) {
      throw new Error("workspace root must be a canonical, non-symlink directory");
    }
    const stats = statSync(root, { bigint: true });
    if (!stats.isDirectory()) throw new Error("workspace root must be an existing directory");
    const home = realpathSync(os.homedir());
    const kiroHome = path.join(home, ".kiro");
    const kiroRelative = path.relative(kiroHome, root);
    const insideKiroHome = kiroRelative === "" ||
      (kiroRelative !== ".." && !kiroRelative.startsWith(`..${path.sep}`) && !path.isAbsolute(kiroRelative));
    const unsafe = [path.parse(root).root, home, this.#pluginRoot, this.#pluginData];
    if (unsafe.includes(root) || insideKiroHome) {
      throw new Error("workspace root is too broad or reserved");
    }
    for (const reserved of [this.#pluginRoot, this.#pluginData]) {
      const rootInsideReserved = path.relative(reserved, root);
      const reservedInsideRoot = path.relative(root, reserved);
      const isContained = (relative: string): boolean =>
        relative === "" ||
        (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
      if (isContained(rootInsideReserved) || isContained(reservedInsideRoot)) {
        throw new Error("workspace root and plugin storage must not contain one another");
      }
    }
    return { id: idFor(root), root, name: path.basename(root) || "workspace", dev: stats.dev, ino: stats.ino };
  }

  updateClientRoots(roots: readonly { uri: string; name?: string | undefined }[]): void {
    const candidates: Candidate[] = [];
    for (const item of roots) {
      try {
        if (!item.uri.startsWith("file:")) continue;
        const candidate = this.#canonical(fileURLToPath(item.uri));
        candidates.push({ ...candidate, name: (item.name?.trim() || candidate.name).slice(0, 120) });
      } catch { /* invalid roots are unavailable, never broadened */ }
    }
    this.#candidates = [...new Map(candidates.map((entry) => [entry.id, entry])).values()];
    if (this.#binding?.source === "client-roots" && !this.#candidates.some((entry) => entry.id === this.#binding!.id)) {
      this.#binding = undefined;
      this.#initialAutoBindAllowed = false;
    }
    if (this.#candidates.length > 1) this.#initialAutoBindAllowed = false;
    if (!this.#binding && this.#initialAutoBindAllowed && this.#candidates.length === 1) {
      this.#binding = { ...this.#candidates[0]!, source: "client-roots" };
      this.#initialAutoBindAllowed = false;
    }
  }

  boundWorkspace(): KiroPowerBoundWorkspace | undefined {
    const binding = this.#binding;
    if (!binding) return undefined;
    try {
      const current = this.#canonical(binding.root);
      if (current.dev !== binding.dev || current.ino !== binding.ino) throw new Error("identity changed");
      return {
        schemaVersion: 1,
        canonicalPath: binding.root,
        deviceId: binding.dev.toString(),
        fileId: binding.ino.toString(),
        rootId: binding.id,
        name: binding.name,
        source: binding.source,
      };
    } catch {
      this.#binding = undefined;
      this.#initialAutoBindAllowed = false;
      return undefined;
    }
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
    if (!this.#elicitor) throw new Error("manual workspace attachment requires MCP elicitation support");
    if (signal?.aborted || !(await this.#elicitor.approveWorkspace(candidate.root, signal)) || signal?.aborted) {
      throw new Error("manual workspace attachment was not approved");
    }
    return { action: "attach", root: candidate.root };
  }

  commitMutation(mutation: KiroPowerWorkspaceMutation): ReturnType<KiroPowerWorkspaceBinding["status"]> {
    if (mutation.action === "detach") {
      this.#binding = undefined;
    } else if (mutation.action === "select") {
      const candidate = this.#candidates.find((entry) => entry.id === mutation.rootId);
      if (!candidate) throw new Error("workspace root selection changed while the request was pending; list and retry");
      const current = this.#canonical(candidate.root);
      if (current.dev !== candidate.dev || current.ino !== candidate.ino) {
        throw new Error("workspace root identity changed while the request was pending; list and retry");
      }
      this.#binding = { ...candidate, source: "client-roots" };
    } else {
      const candidate = this.#canonical(mutation.root);
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
