import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveKiroAgentLaunchContext } from "../src/kiro/power/agent-launch-context.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
const fixture = () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "fabric-launch-")));
  roots.push(root);
  for (const name of ["runtime", "data", "project with spaces"]) fs.mkdirSync(path.join(root, name), { mode: 0o700 });
  return { project: path.join(root, "project with spaces"), env: {
    KIRO_FABRIC_RUNTIME_ROOT: path.join(root, "runtime"),
    KIRO_FABRIC_DATA_ROOT: path.join(root, "data"),
  } };
};

describe("explicit Kiro launcher workspace handoff", () => {
  it.each([undefined, "${KIRO_FABRIC_LAUNCH_WORKSPACE}"])("does not infer a workspace from absent/unexpanded handoff %s", (handoff) => {
    const { env, project } = fixture();
    expect(resolveKiroAgentLaunchContext({ ...env, PWD: project, KIRO_FABRIC_LAUNCH_WORKSPACE: handoff }).launchWorkspaceRoot).toBeUndefined();
  });
  it("accepts an expanded absolute project path with spaces", () => {
    const { env, project } = fixture();
    expect(resolveKiroAgentLaunchContext({ ...env, KIRO_FABRIC_LAUNCH_WORKSPACE: project }).launchWorkspaceRoot).toBe(project);
  });
  it.each(["", "relative", "${OTHER_VARIABLE}"])("rejects invalid explicit handoff %s", (handoff) => {
    const { env } = fixture();
    expect(() => resolveKiroAgentLaunchContext({ ...env, KIRO_FABRIC_LAUNCH_WORKSPACE: handoff })).toThrow(/KIRO_FABRIC_LAUNCH_WORKSPACE/);
  });
  it("still rejects a writable project directory", () => {
    if (process.platform === "win32") return;
    const { env, project } = fixture();
    fs.chmodSync(project, 0o777);
    expect(() => resolveKiroAgentLaunchContext({ ...env, KIRO_FABRIC_LAUNCH_WORKSPACE: project })).toThrow(/writable/);
  });
});
