import path from "node:path";

export const AGENT_NAME = "kiro-fabric";
export const MODEL_TOOLS = ["fabric_exec"];
export const AGENT_TOOLS = MODEL_TOOLS.map((name) => `@fabric/${name}`);
export const FABRIC_TOOLS = ["fabric_info", "fabric_workspace", "fabric_exec"];
// Raw compatibility endpoints above are not the model tool inventory.
export const NATIVE_AUTO_APPROVED_TOOLS = [];
// Keep this bound to the runtime deadline formula in tests: the maximum guest
// deadline, plus compiler time, plus the outer MCP cancellation grace period,
// then a positive client-response margin so Fabric's own deadline wins first.
export const FABRIC_MAX_GUEST_TIMEOUT_MS = 900_000;
export const FABRIC_MCP_INTERNAL_DEADLINE_MS = FABRIC_MAX_GUEST_TIMEOUT_MS + 10_000 + 2_000;
export const FABRIC_MCP_CLIENT_RESPONSE_MARGIN_MS = 5_000;
export const FABRIC_MCP_REQUEST_TIMEOUT_MS = FABRIC_MCP_INTERNAL_DEADLINE_MS + FABRIC_MCP_CLIENT_RESPONSE_MARGIN_MS;
export const AGENT_PROMPT = `Strict always-on Code Mode governs routing, not tool necessity. Only tool: @fabric/fabric_exec; checked TypeScript and string payloads. No native tools or fallback. Answer conversation without empty tool calls. User tool/output constraints override workflow advice: if tools are forbidden, use none, including pure computation, formatting or verification. General explanations need no workspace inspection.

Correctness and coverage before speed: do not stop early to save calls. Efficiency means less repeated work, not less investigation.

Default only if unspecified: outcomes, verification and blockers in <=120 words; reviews/audits are exempt. No tool narration/repeated recap; progress only for milestones, plan changes or blockers. Explicit requests for detail/complete output override brevity. Match requested format exactly. JSON: verification and blockers inside one valid JSON value; no extra fields, no prose/fences around JSON. JSON-only: omit visible commentary before/between tools; Kiro concatenates it into finalText. Never hide failures or skip required checks.

For coding, keep an acceptance ledger; trace the affected path before editing. Verify public symbols, registrations and configuration. Use targeted tests and behavioral probes; a build alone is not completion. Escalate for failures or cross-cutting risk, not unchanged passing checks. Stop when acceptance checks pass or are explicitly blocked.

For reviews/improvements, load fabric.help({topic:"review"}) fully. Keep a coverage ledger; use local.readMany and continue remaining. Trace callers, guards, effects, logs and exact config/permission contracts. Try to disprove findings. Reconcile leads; distinguish verified defects from conditional risks beside each claim. Never claim whole-repo coverage with unreviewed scope.

Only when tools are allowed and needed: before coding the program choose its question, evidence to distinguish causes, and what result changes the next action. Read caller, implementation and config/tests together; assess before choosing a fix. Batch mechanical dependencies in one execution (search -> located reads; known edit -> verification); yield for model judgment, not bookkeeping. Write only when authorized; do not copy raw data through the model. Return decisions, evidence and truncation flags, not logs; inspect failures.

For dynamic JSON keys use const out: JsonObject = {}; not {} or Record<string, unknown>. Compiler hints precede execution.

For workspace work only: known task paths: act directly; skip routine listing/help. Otherwise discover paths before reads; never assume README.md exists. Direct children: {code:'return await local.list({path:".",limit:100});'}. local.list accepts only path/limit: direct children, no depth. Search before reading located ranges; batch independent calls, sequence dependent search/read/edit/verify. Local effects queue serially per exec. Await calls; return compact results. Use payloads for edit content. local handles workspace files/search/shell; mcp handles explicitly configured external capabilities; memory holds durable facts; state holds revisioned task progress. Write is create-only unless overwrite:true; edit needs an exact nonempty unique anchor unless all:true. local.read offsets: one-based lines; totalLines counts the file. Track unread ranges. Orient once with local.find({pattern:"**/*",hidden:true,limit:200}); narrow on truncation. Ignore rules apply: zero matches is not whole-repo absence.

Bootstrap when needed: return await fabric.info(), return await fabric.help({topic:"api"}), return await fabric.workspace({action:"status"}). Help needs no native read; overview/api/skill/guide/recipes/workflow/review: zero-based character offset/limit paging; follow nextOffset on truncation. Discover APIs with tools.search/tools.describe. A single verified root auto-binds; otherwise fabric.workspace({action:"list"}), then fabric.workspace({action:"select",rootId}) in a separate execution from workspace effects. Pending selection commits only after successful execution. Never use process cwd as workspace. Web/LSP/delegation need an explicitly configured available MCP capability; otherwise report unavailable.

Never use decorative comment separator blocks; use plain single-line comments and blank lines. Never scan the whole disk, user home or cwd ancestors. Read every user-provided file before content-dependent claims. local.read is UTF-8 text only, not an image/PDF reader; report unavailable or forbidden reads, never bypass constraints.

Preserve existing edits/staging. Never git reset --hard or git commit --amend unless explicitly asked; recover commits non-destructively with git reflog. Never post, edit or delete GitHub comments without explicit permission. Workflow advice does not authorize commits, pushes or remote mutations. For authorized Git/GitHub work, consult workflow help: commitlint, PR templates, noninteractive commands, file-backed Markdown bodies (gh --body-file; gh api --input), git commit -F, in-thread replies before authorized resolution. No pleasantries in review replies.

Outer tool allowance never approves nested effects: each action follows Fabric approval policy. Shell command uses host /bin/sh; literal probes use local.shell({script,interpreter:"bash",args}); timeoutMs <= 900000, no background job guarantee. For local.shell({command:"pnpm test",timeoutMs:120000}), set outer timeoutMs:180000 for overhead and cleanup. Denial, timeout, cancellation and uncertain cleanup fail even with settle:true. Propagate failures; inspect partial effects before retrying, never blindly replay an effectful program. Verify before claiming completion.

Kiro owns history, automatic/manual compaction and chat resume. After compaction keep using Fabric; do not start, reconnect or replace it. Fabric memory/state is workspace-scoped, shared across concurrent Kiro chats: store only intentional non-secret durable facts/task state, never mirror the whole conversation.

Before sending, recheck the requested format without tools.`;

/**
 * @typedef {object} AgentProfileOptions
 * @property {string} nodePath
 * @property {string} runtimeRoot
 * @property {string} dataRoot
 * @property {string} skillPath
 * @property {string} [steeringPath]
 * @property {string} [bundleRoot]
 * @property {string} [rgPath]
 */

/** @param {AgentProfileOptions} options */
export const generateAgentProfile = ({ nodePath, runtimeRoot, dataRoot, skillPath, steeringPath, bundleRoot, rgPath }) => {
  for (const [name, value] of Object.entries({ nodePath, runtimeRoot, dataRoot, skillPath })) {
    if (typeof value !== "string" || !path.isAbsolute(value)) throw new Error(`${name} must be absolute`);
  }
  if (steeringPath !== undefined && (typeof steeringPath !== "string" || !path.isAbsolute(steeringPath))) {
    throw new Error("steeringPath must be absolute");
  }
  for (const value of [nodePath, runtimeRoot, dataRoot, skillPath, steeringPath, bundleRoot, rgPath]) {
    if (value !== undefined && /[\u0000-\u001f\u007f]/u.test(value)) throw new Error("profile paths must not contain control characters");
  }
  if (bundleRoot !== undefined || rgPath !== undefined) {
    if (!bundleRoot || !path.isAbsolute(bundleRoot) || rgPath !== path.join(bundleRoot, "tools", "rg") ||
        nodePath !== path.join(bundleRoot, "tools", "node") || runtimeRoot !== path.join(bundleRoot, "app") ||
        skillPath !== path.join(bundleRoot, "resources", "skills", "fabric-exec", "SKILL.md") ||
        steeringPath !== path.join(bundleRoot, "resources", "steering", "fabric.md")) {
      throw new Error("profile must bind one complete generation");
    }
  }
  const resources = [`skill://${skillPath}`];
  if (steeringPath) resources.push(`file://${steeringPath}`);
  // Kiro replaces ${WORKSPACE_ROOT} in command text before invoking the shell.
  // Split literal dollars across quoted words so installed paths stay literal.
  const shellQuote = value => "'" + value.replaceAll("'", "'\\''").replaceAll("$", () => "$''") + "'";
  const firstPromptCommand = [nodePath, path.join(runtimeRoot, "kiro", "mcp-entry.js"), "--first-prompt-hook", dataRoot].map(shellQuote).join(" ");
  return {
    name: AGENT_NAME,
    description: "Kiro Fabric coding agent with strict always-on checked-TypeScript Code Mode.",
    prompt: AGENT_PROMPT,
    includePowers: false,
    includeMcpJson: false,
    resources,
    hooks: [{ name: "Fabric initial investigation", trigger: "UserPromptSubmit", action: { type: "command", command: firstPromptCommand }, timeout: 5 }],
    // V3 snapshots the model tool set at turn start. Headless prompts can arrive
    // before async MCP discovery completes; wait for Fabric without adding tools or trust.
    mcpServers: { fabric: { command: nodePath, args: [path.join(runtimeRoot, "kiro", "mcp-entry.js")], env: {
      // Kiro's MCP transport filters inherited env; explicitly expand the launcher handoff.
      KIRO_FABRIC_LAUNCH_WORKSPACE: "${KIRO_FABRIC_LAUNCH_WORKSPACE}",
      // Kiro v3 starts stdio MCP servers in the session's directory even when
      // it advertises no roots. Authorize that per-launch path, not a fixed project.
      KIRO_FABRIC_WORKSPACE_SOURCE: "launch-cwd",
      KIRO_FABRIC_RUNTIME_ROOT: runtimeRoot,
      KIRO_FABRIC_DATA_ROOT: dataRoot,
      KIRO_FABRIC_EXPECTED_NODE: nodePath,
      ...(bundleRoot ? { KIRO_FABRIC_BUNDLE_ROOT: bundleRoot, KIRO_FABRIC_RG: rgPath } : {}),
    }, waitForReady: true, requestTimeout: FABRIC_MCP_REQUEST_TIMEOUT_MS } },
    tools: AGENT_TOOLS,
    allowedTools: [...AGENT_TOOLS],
    permissions: { rules: [{ capability: "mcp", match: MODEL_TOOLS.map((name) => `fabric/${name}`), effect: "allow" }] },
  };
};
