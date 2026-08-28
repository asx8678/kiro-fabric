import type {
  FabricActionDescriptor,
  FabricInvocationContext,
  FabricProvider,
  FabricProviderListRequest,
} from "../protocol.js";
import { CommandBroker, type CommandMeta } from "../core/command-broker.js";
import { EvidenceLedger, type Claim, type ClaimStatus, type EvidenceItem } from "../core/evidence-ledger.js";
import { OutcomeGate, type CompletionCapsule, type GateOutcome, type OutcomeBinding } from "../core/outcome-gate.js";
import fs from "node:fs";
import path from "node:path";

/**
 * Evidence ledger provider (PR4): exposes the shared claim ledger, command
 * broker, and outcome gate as model-facing `evidence.*` actions. The provider
 * makes findings commit-scoped, lemma-verified, and contradiction-checked
 * before synthesis — findings must survive a falsification lifecycle to count.
 */

interface EvidenceProviderTrustedCommand {
  command: string;
  args: string[];
  shell: boolean;
  timeoutMs: number;
}

export interface EvidenceProviderContext {
  /** Root under which per-session evidence journals and command caches live. */
  evidenceRoot: string;
  /** Session identity used to scope the per-run ledger. */
  sessionId: string;
  /** Optional host-owned workspace boundary and exact command allowlist. */
  workspaceRoot?: string;
  trustedCommands?: Readonly<Record<string, EvidenceProviderTrustedCommand>>;
}

const MAX_CLAIM_STATEMENT_BYTES = 4 * 1024;
const MAX_EVIDENCE_ITEMS = 32;

const descriptors: FabricActionDescriptor[] = [
  {
    name: "submit",
    description:
      "Submit a falsifiable claim with evidence level and references. A complete commit/tree binding is required for later bound evaluation. Returns the deterministic claimId and existing record if re-raised.",
    inputSchema: {
      type: "object",
      properties: {
        statement: { type: "string" },
        commit: { type: "string" },
        confidence: { type: "string", enum: ["low", "medium", "high"] },
        severity: { type: "string", enum: ["critical", "high", "medium", "low", "info"] },
        evidenceLevel: {
          type: "string",
          enum: ["assertion", "code_read", "grep_match", "targeted_test", "reproduction", "command_output"],
        },
        evidence: {
          type: "array",
          items: {
            type: "object",
            properties: { ref: { type: "string" }, detail: { type: "string" } },
            required: ["ref"],
          },
        },
        criterionId: { type: "string" },
        evidenceSource: { type: "string", enum: ["assertion", "worker", "verifier", "oracle"] },
        binding: {
          type: "object",
          properties: {
            sessionId: { type: "string" },
            commit: { type: "string" },
            treeHash: { type: "string" },
          },
          required: ["commit", "treeHash"],
          additionalProperties: false,
        },
      },
      required: ["statement", "commit"],
      additionalProperties: false,
    },
    risk: "write",
  },
  {
    name: "hypothesize",
    description: "Repeat a submitted claim as a testable hypothesis.",
    inputSchema: {
      type: "object",
      properties: {
        claimId: { type: "string" },
        statement: { type: "string", description: "used only when claimId is absent" },
        commit: { type: "string" },
      },
      additionalProperties: false,
    },
    risk: "write",
  },
  {
    name: "support",
    description: "Mark a hypothesis as surviving adversarial review, with supporting evidence.",
    inputSchema: {
      type: "object",
      properties: {
        claimId: { type: "string" },
        by: { type: "string" },
        evidence: {
          type: "array",
          items: {
            type: "object",
            properties: { ref: { type: "string" }, detail: { type: "string" } },
            required: ["ref"],
          },
        },
      },
      required: ["claimId"],
      additionalProperties: false,
    },
    risk: "write",
  },
  {
    name: "falsify",
    description: "Falsify a claim with counter-evidence, demoting it from any confirmed state.",
    inputSchema: {
      type: "object",
      properties: {
        claimId: { type: "string" },
        by: { type: "string" },
        note: { type: "string" },
        counterevidence: {
          type: "array",
          items: {
            type: "object",
            properties: { ref: { type: "string" }, detail: { type: "string" } },
            required: ["ref"],
          },
        },
      },
      required: ["claimId", "counterevidence"],
      additionalProperties: false,
    },
    risk: "write",
  },
  {
    name: "confirm",
    description:
      "Confirm a supported claim to its terminal verdict, attaching the supporting evidence.",
    inputSchema: {
      type: "object",
      properties: {
        claimId: { type: "string" },
        by: { type: "string" },
        note: { type: "string" },
        evidence: {
          type: "array",
          items: {
            type: "object",
            properties: { ref: { type: "string" }, detail: { type: "string" } },
            required: ["ref"],
          },
        },
      },
      required: ["claimId", "by"],
      additionalProperties: false,
    },
    risk: "write",
  },
  {
    name: "query",
    description: "Query the ledger by exact claimId or statement fuzzy-match.",
    inputSchema: {
      type: "object",
      properties: {
        claimId: { type: "string" },
        statement: { type: "string" },
        status: {
          type: "string",
          enum: ["UNREVIEWED", "HYPOTHESIS", "SUPPORTED", "CONFIRMED", "PARTIALLY_CONFIRMED", "FALSIFIED"],
        },
      },
      additionalProperties: false,
    },
    risk: "read",
  },
  {
    name: "summary",
    description: "Compute the deterministic claim-set summary (status totals, confirmed/falsified ids).",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    risk: "read",
  },
  {
    name: "run",
    description:
      "Execute a deterministic command through the central broker. All agents share the cached result keyed by commit/tree hash.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Exact trusted-command name when a host allowlist is configured" },
        command: { type: "string" },
        args: { type: "array", items: { type: "string" } },
        cwd: { type: "string" },
        commit: { type: "string" },
        treeHash: { type: "string" },
        seed: { type: "string" },
        db: { type: "string" },
      },
      required: ["command", "args", "cwd", "commit", "treeHash"],
      additionalProperties: false,
    },
    risk: "execute",
  },
  {
    name: "evaluate",
    description:
      "Run the outcome gate: compute the completion capsule and decide accept/defer/reject. When binding is supplied, every terminal claim must match its commit/tree and optional session exactly.",
    inputSchema: {
      type: "object",
      properties: {
        criteria: {
          type: "array",
          items: {
            type: "object",
            properties: {
              criterionId: { type: "string" },
              statement: { type: "string" },
            },
            required: ["criterionId"],
            additionalProperties: false,
          },
        },
        binding: {
          type: "object",
          properties: {
            sessionId: { type: "string" },
            commit: { type: "string" },
            treeHash: { type: "string" },
          },
          required: ["commit", "treeHash"],
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    },
    risk: "read",
  },
];

export class EvidenceProvider implements FabricProvider {
  readonly name = "evidence";
  readonly description =
    "Shared evidence ledger, central command broker, and deterministic outcome gate";

  readonly #ledger: EvidenceLedger;
  readonly #broker: CommandBroker;
  readonly #gate: OutcomeGate;

  constructor(private readonly context: EvidenceProviderContext) {
    this.#ledger = EvidenceLedger.open(context.evidenceRoot);
    this.#broker = new CommandBroker();
    this.#gate = new OutcomeGate(this.#ledger);
  }

  async list(
    request: FabricProviderListRequest,
    _context: FabricInvocationContext,
  ): Promise<FabricActionDescriptor[]> {
    const query = request.query?.toLowerCase();
    return query
      ? descriptors.filter((d) => `${d.name} ${d.description}`.toLowerCase().includes(query))
      : descriptors;
  }

  async describe(
    actionName: string,
    _context: FabricInvocationContext,
  ): Promise<FabricActionDescriptor | undefined> {
    return descriptors.find((d) => d.name === actionName);
  }

  async invoke(
    actionName: string,
    args: Record<string, unknown>,
    context: FabricInvocationContext,
  ): Promise<unknown> {
    switch (actionName) {
      case "submit": {
        const statement = this.#statement(args.statement);
        const commit = this.#stringArg(args.commit, "commit");
        if (Buffer.byteLength(statement, "utf8") > MAX_CLAIM_STATEMENT_BYTES) {
          throw new Error(`evidence.submit statement exceeds ${MAX_CLAIM_STATEMENT_BYTES} bytes`);
        }
        const evidence = this.#evidenceItems(args.evidence).slice(0, MAX_EVIDENCE_ITEMS);
        const confidence = this.#confidence(args.confidence);
        const severity = this.#severity(args.severity);
        const evidenceLevel = this.#evidenceLevel(args.evidenceLevel);
        const by = this.#optionalString(args.by, "by");
        const criterionId = this.#optionalString(args.criterionId, "criterionId");
        const evidenceSource = this.#optionalEvidenceSource(args.evidenceSource);
        const binding = this.#claimBinding(args.binding, commit);
        const claim = this.#ledger.submit({
          statement,
          commit,
          ...(confidence === undefined ? {} : { confidence }),
          ...(severity === undefined ? {} : { severity }),
          ...(evidenceLevel === undefined ? {} : { evidenceLevel }),
          ...(evidence.length > 0 ? { evidence } : {}),
          ...(by === undefined ? {} : { by }),
          ...(criterionId === undefined ? {} : { criterionId }),
          ...(evidenceSource === undefined ? {} : { evidenceSource }),
          ...(binding === undefined ? {} : { binding }),
        });
        return { claimId: claim.claimId, status: claim.status, created: false };
      }
      case "hypothesize": {
        const claimId = this.#stringArg(args.claimId, "claimId");
        this.#ledger.hypothesize(claimId, this.#optionalString(args.by, "by"));
        return { claimId, status: "HYPOTHESIS" };
      }
      case "support": {
        const claimId = this.#stringArg(args.claimId, "claimId");
        const by = this.#stringArg(args.by, "by");
        this.#ledger.support(claimId, by, this.#evidenceItems(args.evidence).slice(0, MAX_EVIDENCE_ITEMS));
        return { claimId, status: "SUPPORTED" };
      }
      case "falsify": {
        const claimId = this.#stringArg(args.claimId, "claimId");
        const by = this.#stringArg(args.by, "by");
        this.#ledger.falsify(
          claimId,
          by,
          this.#evidenceItems(args.counterevidence).slice(0, MAX_EVIDENCE_ITEMS),
          this.#optionalString(args.note, "note"),
        );
        return { claimId, status: "FALSIFIED" };
      }
      case "confirm": {
        const claimId = this.#stringArg(args.claimId, "claimId");
        const by = this.#stringArg(args.by, "by");
        const evidence = this.#evidenceItems(args.evidence).slice(0, MAX_EVIDENCE_ITEMS);
        const options: { by: string; note?: string; evidence?: EvidenceItem[] } = { by };
        const note = this.#optionalString(args.note, "note");
        if (note) options.note = note;
        if (evidence.length > 0) options.evidence = evidence;
        this.#ledger.transition(claimId, "CONFIRMED", options);
        return { claimId, status: "CONFIRMED" };
      }
      case "query": {
        const claimId = this.#optionalString(args.claimId, "claimId");
        const status = this.#optionalStatus(args.status);
        if (claimId) {
          const claim = this.#ledger.get(claimId);
          return { found: !!claim, claim };
        }
        const statement = this.#optionalString(args.statement, "statement");
        const matches = statement
          ? this.#ledger.findSimilar(statement)
          : this.#ledger.list(status === undefined ? {} : { status });
        return { matches, count: matches.length };
      }
      case "summary": {
        return this.#ledger.summarize();
      }
      case "run": {
        const seed = this.#optionalString(args.seed, "seed");
        const db = this.#optionalString(args.db, "db");
        const requestedCwd = this.#stringArg(args.cwd, "cwd");
        const requestedCommit = this.#stringArg(args.commit, "commit");
        const requestedTree = this.#stringArg(args.treeHash, "treeHash");
        const cwd = this.#authorizeCwd(requestedCwd);
        // Validate the host-owned path and exact command contract before
        // consulting caller-provided freshness claims. This keeps authorization
        // errors deterministic and ensures no identity claim can authorize an
        // otherwise forbidden executable.
        const command = this.#authorizedCommand(args);
        const commandArgs = this.#authorizedArgs(args);
        this.#assertInvocationIdentities(cwd, requestedCommit, requestedTree);
        const meta: CommandMeta = {
          command,
          args: commandArgs,
          cwd,
          commit: requestedCommit,
          treeHash: requestedTree,
          ...(seed === undefined ? {} : { seed }),
          ...(db === undefined ? {} : { db }),
        };
        const result = await this.#broker.execute(meta);
        return {
          exitCode: result.exitCode,
          cached: result.cached,
          durationMs: result.durationMs,
          stdout: result.stdout.slice(0, 16 * 1024),
          stderr: result.stderr.slice(0, 4 * 1024),
        };
      }
      case "evaluate": {
        const requestedBinding = args.binding === undefined
          ? undefined
          : this.#outcomeBinding(args.binding);
        const binding = this.#verifiedWorkspaceBinding(requestedBinding, "evaluate");
        const outcome = this.#gate.evaluate({
          ...(args?.criteria ? { criteria: args.criteria as Array<{ criterionId: string; statement?: string }> } : {}),
          ...(binding ? { binding } : {}),
        });
        return { ...outcome } satisfies GateOutcome;
      }
      default:
        throw new Error(`Unknown evidence action: ${actionName}`);
    }
  }

  /** Convenience forguards programmatic access by host code. */
  capsule(): CompletionCapsule {
    return this.#gate.capsule();
  }

  /**
   * Resolve the executable when a trusted-command allowlist is configured. If
   * `trustedCommands` is absent, arbitrary (legacy) executables remain allowed.
   * When present, `run` must name one of the configured commands (either by the
   * configured key in `name` or by its exact `command` +
   * `args`), and the exact configured argv/executable is used.
   */
  #authorizedCommand(args: Record<string, unknown>): string {
    const trusted = this.context.trustedCommands;
    const command = this.#stringArg(args.command, "command");
    if (trusted === undefined) return command;
    const requestedArgs = this.#stringArray(args.args, "args");
    const byName = this.#optionalString(args.name, "name");
    let entry: EvidenceProviderTrustedCommand | undefined;
    if (byName !== undefined) {
      entry = trusted[byName];
      if (!entry) throw new Error(`evidence.run: no configured trusted command named "${byName}"`);
      if (entry.command !== command) {
        throw new Error(`evidence.run: configured command "${byName}" does not match command "${command}"`);
      }
      if (JSON.stringify(entry.args) !== JSON.stringify(requestedArgs)) {
        throw new Error(`evidence.run: configured command "${byName}" does not accept the requested args`);
      }
    } else {
      const match = Object.values(trusted).find(
        (t) => t.command === command && JSON.stringify(t.args) === JSON.stringify(requestedArgs),
      );
      if (!match) {
        throw new Error(`evidence.run: command "${command}" is not an exact configured trusted command`);
      }
      entry = match;
    }
    return entry.command;
  }

  /**
   * When a trusted-command allowlist is configured, the argv must be an exact
   * match for the configured entry; otherwise return the caller-supplied argv
   * unchanged (legacy behavior).
   */
  #authorizedArgs(args: Record<string, unknown>): string[] {
    const trusted = this.context.trustedCommands;
    const requestedArgs = this.#stringArray(args.args, "args");
    if (trusted === undefined) return requestedArgs;
    const command = this.#stringArg(args.command, "command");
    const byName = this.#optionalString(args.name, "name");
    const entry = byName !== undefined ? trusted[byName] : Object.values(trusted).find((t) => t.command === command);
    if (!entry) {
      throw new Error(`evidence.run: no configured trusted command matches requested executable "${command}"`);
    }
    if (JSON.stringify(entry.args) !== JSON.stringify(requestedArgs)) {
      throw new Error(`evidence.run: argv must match the configured trusted command exactly`);
    }
    return entry.args;
  }

  /**
   * When a host-owned workspace root is configured, the requested cwd must sit
   * inside it. Otherwise (legacy) the caller-supplied cwd is used unchanged.
   */
  #authorizeCwd(requested: string): string {
    const root = this.context.workspaceRoot;
    if (root === undefined) return requested;
    const requestedResolved = fs.realpathSync(path.resolve(requested));
    const rootResolved = fs.realpathSync(path.resolve(root));
    if (requestedResolved !== rootResolved && !requestedResolved.startsWith(rootResolved + path.sep)) {
      throw new Error(`evidence.run: cwd "${requested}" is outside the host-owned workspace "${root}"`);
    }
    return requestedResolved;
  }

  /**
   * Fail closed when a caller supplies an invocation identity (commit/tree) that
   * does not match the actual workspace HEAD/tree of the current invocation cwd.
   * This is only enforced when a host-owned workspace root is configured.
   */
  #assertInvocationIdentities(cwd: string, requestedCommit: string, requestedTree: string): void {
    if (!this.context.workspaceRoot) return;
    const actualCommit = CommandBroker.commitHash(cwd);
    const actualTree = CommandBroker.treeHash(cwd);
    if (actualCommit === "no-git" || actualTree === "no-git") {
      throw new Error("evidence.run: cannot establish a host-owned commit and tree identity");
    }
    if (requestedCommit !== actualCommit) {
      throw new Error(`evidence.run: supplied commit "${requestedCommit}" does not match the workspace ("${actualCommit}")`);
    }
    if (requestedTree !== actualTree) {
      throw new Error(`evidence.run: supplied treeHash "${requestedTree}" does not match the workspace ("${actualTree}")`);
    }
  }

  #statement(value: unknown): string {
    if (typeof value !== "string" || !value.trim()) {
      throw new Error("statement must be a non-empty string");
    }
    return value.trim();
  }

  #claimBinding(value: unknown, claimCommit: string): Claim["binding"] | undefined {
    const requested = value === undefined ? undefined : this.#outcomeBinding(value);
    if (requested && requested.commit !== claimCommit) {
      throw new Error("binding.commit must match commit");
    }
    const binding = this.#verifiedWorkspaceBinding(requested, "submit");
    if (binding && binding.commit !== claimCommit) {
      throw new Error(
        `evidence.submit: supplied commit "${claimCommit}" does not match the host workspace ("${binding.commit}")`,
      );
    }
    return binding;
  }

  #verifiedWorkspaceBinding(
    requested: OutcomeBinding | undefined,
    action: "submit" | "evaluate",
  ): OutcomeBinding | undefined {
    const root = this.context.workspaceRoot;
    if (root === undefined) return requested;
    const commit = CommandBroker.commitHash(root);
    const treeHash = CommandBroker.treeHash(root);
    const sessionId = this.context.sessionId.trim();
    if (commit === "no-git" || treeHash === "no-git" || sessionId.length === 0) {
      throw new Error(
        `evidence.${action}: cannot establish a host-owned commit, tree, and session identity`,
      );
    }
    const actual: OutcomeBinding = { commit, treeHash, sessionId };
    if (requested !== undefined) {
      if (requested.commit !== actual.commit) {
        throw new Error(
          `evidence.${action}: supplied binding.commit "${requested.commit}" does not match the host workspace ("${actual.commit}")`,
        );
      }
      if (requested.treeHash !== actual.treeHash) {
        throw new Error(
          `evidence.${action}: supplied binding.treeHash "${requested.treeHash}" does not match the host workspace ("${actual.treeHash}")`,
        );
      }
      if (requested.sessionId !== undefined && requested.sessionId !== actual.sessionId) {
        throw new Error(
          `evidence.${action}: supplied binding.sessionId does not match the host session`,
        );
      }
    }
    return actual;
  }

  #outcomeBinding(value: unknown): OutcomeBinding {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new Error("binding must be an object");
    }
    const record = value as Record<string, unknown>;
    const commit = this.#nonEmptyString(record.commit, "binding.commit");
    const treeHash = this.#nonEmptyString(record.treeHash, "binding.treeHash");
    const sessionId = this.#optionalNonEmptyString(record.sessionId, "binding.sessionId");
    return { commit, treeHash, ...(sessionId === undefined ? {} : { sessionId }) };
  }

  #nonEmptyString(value: unknown, name: string): string {
    if (typeof value !== "string" || value.length === 0) {
      throw new Error(`${name} must be a non-empty string`);
    }
    return value;
  }

  #optionalNonEmptyString(value: unknown, name: string): string | undefined {
    return value === undefined ? undefined : this.#nonEmptyString(value, name);
  }

  #stringArg(value: unknown, name: string): string {
    if (typeof value !== "string") throw new Error(`${name} must be a string`);
    return value;
  }

  #optionalString(value: unknown, name: string): string | undefined {
    return value === undefined ? undefined : this.#stringArg(value, name);
  }

  #optionalEvidenceSource(value: unknown): Claim["evidenceSource"] | undefined {
    if (value === undefined) return undefined;
    if (value !== "assertion" && value !== "worker" && value !== "verifier" && value !== "oracle") {
      throw new Error("evidenceSource must be assertion|worker|verifier|oracle");
    }
    return value;
  }

  #confidence(value: unknown): Claim ["confidence"] | undefined {
    if (value === undefined) return undefined;
    if (value !== "low" && value !== "medium" && value !== "high") {
      throw new Error("confidence must be low|medium|high");
    }
    return value;
  }

  #severity(value: unknown): Claim["severity"] | undefined {
    if (value === undefined) return undefined;
    if (!["critical", "high", "medium", "low", "info"].includes(String(value))) {
      throw new Error("severity must be critical|high|medium|low|info");
    }
    return value as Claim["severity"];
  }

  #evidenceLevel(value: unknown): Claim["evidenceLevel"] | undefined {
    if (value === undefined) return undefined;
    const valid: Claim["evidenceLevel"][] = [
      "assertion",
      "code_read",
      "grep_match",
      "targeted_test",
      "reproduction",
      "command_output",
    ];
    if (!valid.includes(value as Claim["evidenceLevel"])) {
      throw new Error(`evidenceLevel must be one of ${valid.join("|")}`);
    }
    return value as Claim["evidenceLevel"];
  }

  #evidenceItems(value: unknown): Claim["evidence"][0][] {
    if (value === undefined) return [];
    if (!Array.isArray(value)) throw new Error("evidence must be an array");
    return value.map((item) => {
      if (typeof item !== "object" || item === null || Array.isArray(item)) {
        throw new Error("evidence items must be objects with ref");
      }
      const ref = this.#stringArg((item as Record<string, unknown>).ref, "ref");
      const detail = this.#optionalString((item as Record<string, unknown>).detail, "detail");
      return detail === undefined ? { ref } : { ref, detail };
    });
  }

  #stringArray(value: unknown, name: string): string[] {
    if (!Array.isArray(value)) throw new Error(`${name} must be an array`);
    return value.map((item) => this.#stringArg(item, name));
  }

  #optionalStatus(value: unknown): ClaimStatus | undefined {
    if (value === undefined) return undefined;
    const valid: ClaimStatus[] = [
      "UNREVIEWED",
      "HYPOTHESIS",
      "SUPPORTED",
      "CONFIRMED",
      "PARTIALLY_CONFIRMED",
      "FALSIFIED",
    ];
    if (!valid.includes(value as ClaimStatus)) {
      throw new Error(`status must be one of ${valid.join("|")}`);
    }
    return value as ClaimStatus;
  }
}
