import { removeFixtureSync } from "./fixture-cleanup.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveKiroAgentLaunchContext } from "../src/kiro/power/agent-launch-context.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) removeFixtureSync(root, { recursive: true, force: true }); });
const fixture = () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "fabric-launch-")));
  roots.push(root);
  for (const name of ["runtime", "data", "project with spaces"]) fs.mkdirSync(path.join(root, name), { mode: 0o700 });
  return { project: path.join(root, "project with spaces"), env: {
    KIRO_FABRIC_RUNTIME_ROOT: path.join(root, "runtime"),
    KIRO_FABRIC_DATA_ROOT: path.join(root, "data"),
  } };
};
const unexpectedCwd = (): never => { throw new Error("cwd must not be consulted"); };

describe("Kiro launch workspace authority", () => {
  it.each([undefined, "${KIRO_FABRIC_LAUNCH_WORKSPACE}"])("unconfigured launches do not infer a workspace from absent/unexpanded handoff %s", (handoff) => {
    const { env, project } = fixture();
    expect(resolveKiroAgentLaunchContext({ ...env, PWD: project, KIRO_FABRIC_LAUNCH_WORKSPACE: handoff }, unexpectedCwd).launchWorkspaceRoot).toBeUndefined();
  });
  it.each([undefined, "${KIRO_FABRIC_LAUNCH_WORKSPACE}"])("the installed profile captures Kiro's launch directory without a handoff (%s)", handoff => {
    const { env, project } = fixture();
    let calls = 0;
    const launch = resolveKiroAgentLaunchContext({ ...env, PWD: "/stale-shell-directory", KIRO_FABRIC_WORKSPACE_SOURCE: "launch-cwd", KIRO_FABRIC_LAUNCH_WORKSPACE: handoff }, () => { calls++; return project; });
    expect(launch.launchWorkspaceRoot).toBe(project);
    expect(calls).toBe(1);
  });
  it("keeps independent session launch directories instead of pinning the install path", () => {
    const a = fixture(), b = fixture();
    const env = { ...a.env, KIRO_FABRIC_WORKSPACE_SOURCE: "launch-cwd" };
    expect(resolveKiroAgentLaunchContext(env, () => a.project).launchWorkspaceRoot).toBe(a.project);
    expect(resolveKiroAgentLaunchContext(env, () => b.project).launchWorkspaceRoot).toBe(b.project);
  });
  it.each([undefined, "launch-cwd"])("an expanded absolute handoff with spaces wins over cwd (source %s)", source => {
    const { env, project } = fixture();
    expect(resolveKiroAgentLaunchContext({ ...env, KIRO_FABRIC_WORKSPACE_SOURCE: source, KIRO_FABRIC_LAUNCH_WORKSPACE: project }, unexpectedCwd).launchWorkspaceRoot).toBe(project);
  });
  it.each(["", "relative", "${OTHER_VARIABLE}"])("rejects invalid explicit handoff %s instead of using cwd", (handoff) => {
    const { env } = fixture();
    for (const source of [undefined, "launch-cwd"]) {
      expect(() => resolveKiroAgentLaunchContext({ ...env, KIRO_FABRIC_WORKSPACE_SOURCE: source, KIRO_FABRIC_LAUNCH_WORKSPACE: handoff }, unexpectedCwd)).toThrow(/KIRO_FABRIC_LAUNCH_WORKSPACE/);
    }
  });
  it.each(["", "cwd", "${PWD}", "/some/project"])("rejects an unknown workspace source %s", source => {
    const { env } = fixture();
    expect(() => resolveKiroAgentLaunchContext({ ...env, KIRO_FABRIC_WORKSPACE_SOURCE: source }, unexpectedCwd)).toThrow(/KIRO_FABRIC_WORKSPACE_SOURCE/);
  });
  it.each(["relative", "/nonexistent-fabric-launch-directory"])("rejects invalid launch directories %s", cwd => {
    const { env } = fixture();
    expect(() => resolveKiroAgentLaunchContext({ ...env, KIRO_FABRIC_WORKSPACE_SOURCE: "launch-cwd" }, () => cwd)).toThrow(/MCP launch directory/);
  });
  it("enables same-call Fovea context only for the exact profile token", () => {
    const { env } = fixture();
    expect(resolveKiroAgentLaunchContext(env, unexpectedCwd).foveaCallContext).toBeUndefined();
    expect(resolveKiroAgentLaunchContext({ ...env, KIRO_FABRIC_FOVEA_CALL_CONTEXT: "${KIRO_FABRIC_FOVEA_CALL_CONTEXT}" }, unexpectedCwd).foveaCallContext).toBeUndefined();
    expect(resolveKiroAgentLaunchContext({ ...env, KIRO_FABRIC_FOVEA_CALL_CONTEXT: "0" }, unexpectedCwd).foveaCallContext).toBeUndefined();
    expect(resolveKiroAgentLaunchContext({ ...env, KIRO_FABRIC_FOVEA_CALL_CONTEXT: "1" }, unexpectedCwd).foveaCallContext).toBe(true);
    expect(() => resolveKiroAgentLaunchContext({ ...env, KIRO_FABRIC_FOVEA_CALL_CONTEXT: "true" }, unexpectedCwd)).toThrow(/KIRO_FABRIC_FOVEA_CALL_CONTEXT/);
  });
  it("does not hide a missing launch directory by falling back to PWD", () => {
    const { env, project } = fixture();
    expect(() => resolveKiroAgentLaunchContext({ ...env, PWD: project, KIRO_FABRIC_WORKSPACE_SOURCE: "launch-cwd" }, () => { throw new Error("cwd disappeared"); })).toThrow("cwd disappeared");
  });
  it("still rejects writable and symlinked workspace directories", () => {
    if (process.platform === "win32") return;
    const { env, project } = fixture();
    const link = project + "-alias";
    fs.symlinkSync(project, link);
    expect(() => resolveKiroAgentLaunchContext({ ...env, KIRO_FABRIC_WORKSPACE_SOURCE: "launch-cwd" }, () => link)).toThrow(/symlink/i);
    fs.chmodSync(project, 0o777);
    expect(() => resolveKiroAgentLaunchContext({ ...env, KIRO_FABRIC_LAUNCH_WORKSPACE: project })).toThrow(/writable/);
    expect(() => resolveKiroAgentLaunchContext({ ...env, KIRO_FABRIC_WORKSPACE_SOURCE: "launch-cwd" }, () => project)).toThrow(/writable/);
  });
});
