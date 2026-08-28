// Run-scoped v3 profile source and engine marker. The exact agent is projected
// onto KAS over ACP; Kiro 2.20.1 still keeps KAS sessions under the authenticated
// OS HOME even when KIRO_HOME is set.

import { randomBytes } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultMcpEntryPath } from "./managed.js";
import { generateKiroProfile, type KiroProfileDocument } from "./profile.js";
import {
  serializeKiroChildTools,
  type KiroChildTool,
} from "./run-scope.js";

export interface KiroRunProfileOptions {
  projectRoot: string;
  cwd: string;
  tools: readonly KiroChildTool[];
  mcpEntryPath?: string;
  nodePath?: string;
  /** Propagate the parent's trusted-local shell grant into this child only. */
  allowShell?: boolean;
  /** Stable profile/engine-marker directory for a durable actor. */
  home?: string;
}

export interface KiroRunLease {
  home: string;
  profilePath: string;
  /** Exact source for both the persisted profile and KAS custom-agent projection. */
  profile: KiroProfileDocument;
  cleanup(): void;
}

export const materializeKiroRunProfile = (
  options: KiroRunProfileOptions,
): KiroRunLease => {
  const ownsHome = options.home === undefined;
  const id = randomBytes(16).toString("hex");
  const home = options.home ?? join(tmpdir(), "kiro-fabric-kiro-runs", id);
  const agentDir = join(home, ".kiro", "agents");
  mkdirSync(agentDir, { recursive: true, mode: 0o700 });
  const profile = generateKiroProfile({
    projectRoot: options.projectRoot,
    mcpEntryPath: options.mcpEntryPath ?? defaultMcpEntryPath(),
    ...(options.nodePath ? { nodePath: options.nodePath } : {}),
    ...(options.allowShell ? { allowShell: true } : {}),
    internalChild: {
      cwd: options.cwd,
      serializedTools: serializeKiroChildTools(options.tools),
    },
  });
  const profilePath = join(agentDir, "kiro-fabric.json");
  writeFileSync(profilePath, `${JSON.stringify(profile, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  return {
    home,
    profilePath,
    profile,
    cleanup() {
      if (ownsHome) rmSync(home, { recursive: true, force: true });
    },
  };
};
