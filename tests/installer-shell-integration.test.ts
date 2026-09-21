import { removeFixtureSync } from "./fixture-cleanup.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { planShellIntegration, applyShellIntegration } from "../scripts/installer-shell-integration.mjs";
import { parseManagerArguments } from "../scripts/install-manager.mjs";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) removeFixtureSync(root, { recursive: true, force: true }); });
function fixture(shell = "bash", original: string | null = "# user's settings without final newline") {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "fabric-shell-"))); roots.push(root);
  const home = path.join(root, "home ' ü"), kiro = path.join(home, "custom kiro"), bin = path.join(root, "bin");
  for (const directory of [home, kiro, path.join(kiro, "kiro-fabric"), path.join(kiro, "agents"), bin]) fs.mkdirSync(directory, { mode: 0o700 });
  fs.writeFileSync(path.join(kiro, "agents/kiro-fabric.json"), "{}", { mode: 0o600 });
  const file = path.join(home, shell === "zsh" ? ".zshrc" : ".bashrc");
  if (original !== null) fs.writeFileSync(file, original, { mode: 0o600 });
  fs.writeFileSync(path.join(bin, "kiro-cli"), '#!/bin/sh\nprintf "%s\\n" "${KIRO_FABRIC_LAUNCH_WORKSPACE-unset}" "${KIRO_HOME-unset}" "$@"\nexit 23\n', { mode: 0o700 });
  const env = { HOME: home, SHELL: `/bin/${shell}`, PATH: bin, KIRO_HOME: "/caller-home" };
  const plan = (remove = false) => planShellIntegration(kiro, { env, remove });
  return { root, home, kiro, file, env, plan, install: () => applyShellIntegration(kiro, plan()) };
}

import { fixture as bundleFixture } from './bundle-fixture.js';
import { installCompleteGeneration, retireCompleteInstallation } from '../scripts/managed-installation.mjs';
import { acquireInstallationLock } from '../scripts/installer-lock.mjs';

async function coreFixture() {
 const f=fixture();fs.unlinkSync(path.join(f.kiro,'agents/kiro-fabric.json'));
 const bundle=await bundleFixture();roots.push(bundle);
 const opts={kiroHome:f.kiro,userHome:f.home,env:{},provenance:'source',validateCandidate:async()=>{}};
 const plan=f.plan();if(plan.file===undefined)throw Error('Fixture needs a planned shell path');
 const core=await installCompleteGeneration(bundle,opts);
 return {...f,bundle,opts,initialPlan:plan,core};
}

describe('owner-bound shell postcommit integration',()=>{
 it('refuses delayed installation plan after retirement before writing backup or rc',async()=>{
  const f=await coreFixture(),before=fs.readFileSync(f.file),entries=fs.readdirSync(f.home);
  await retireCompleteInstallation(f.kiro);
  expect(()=>applyShellIntegration(f.kiro,f.initialPlan,{expectedOwner:f.core.owner})).toThrow(/superseded/);
  expect(fs.readFileSync(f.file)).toEqual(before);expect(fs.readdirSync(f.home)).toEqual(entries);
  expect(fs.existsSync(path.join(f.kiro,'kiro-fabric/shell-integration.json'))).toBe(false);
 });
 it('refuses delayed retirement removal after SAME generation reactivation (transaction identity matters)',async()=>{
  const f=await coreFixture();applyShellIntegration(f.kiro,f.initialPlan,{expectedOwner:f.core.owner});
  const removal=f.plan(true),retired=await retireCompleteInstallation(f.kiro),active=await installCompleteGeneration(f.bundle,f.opts);
  expect(active.owner.currentRuntime).toBe(f.core.owner.currentRuntime);expect(active.owner.transactionId).not.toBe(f.core.owner.transactionId);
  const state=path.join(f.kiro,'kiro-fabric/shell-integration.json'),before=fs.readFileSync(f.file),record=fs.readFileSync(state);
  let failure:any;try{applyShellIntegration(f.kiro,removal,{expectedOwner:retired.owner});}catch(error){failure=error;}
  expect(failure).toMatchObject({code:'INSTALL_SHELL_SUPERSEDED',superseded:true,dataPreserved:true});
  expect(fs.readFileSync(f.file)).toEqual(before);expect(fs.readFileSync(state)).toEqual(record);
  const fresh=await retireCompleteInstallation(f.kiro);expect(applyShellIntegration(f.kiro,f.plan(true),{expectedOwner:fresh.owner}).status).toBe('removed');
 });
 it('rejects old active plan after retirement/reactivation even though status and runtime match',async()=>{
  const f=await coreFixture();await retireCompleteInstallation(f.kiro);const current=await installCompleteGeneration(f.bundle,f.opts);
  expect(()=>applyShellIntegration(f.kiro,f.initialPlan,{expectedOwner:f.core.owner})).toThrow(/superseded/);
  expect(applyShellIntegration(f.kiro,f.initialPlan,{expectedOwner:current.owner}).status).toBe('configured');
 });
 it.each(['wrong intent','null owner','pending transaction','foreign transaction','modified control','modified owner'])('rejects %s without shell mutation',async kind=>{
  const f=await coreFixture();let plan=f.initialPlan,owner:any=f.core.owner;
  if(kind==='wrong intent')plan={...plan,remove:true};
  if(kind==='null owner')owner=null;
  if(kind==='pending transaction')fs.writeFileSync(f.core.paths.journal,'unknown',{mode:0o600});
  if(kind==='foreign transaction')fs.writeFileSync(path.join(path.dirname(f.core.paths.journal),'foreign.json'),'unknown',{mode:0o600});
  if(kind==='modified control')fs.appendFileSync(f.core.paths.profile,'foreign');
  if(kind==='modified owner')fs.appendFileSync(f.core.paths.manifest,' ');
  const before=fs.readFileSync(f.file);expect(()=>applyShellIntegration(f.kiro,plan,{expectedOwner:owner})).toThrow(/superseded/);expect(fs.readFileSync(f.file)).toEqual(before);
 });
 it('uses the same core lock and preserves busy state',async()=>{
  const f=await coreFixture(),before=fs.readFileSync(f.file),unlock=acquireInstallationLock(f.core.paths.base);
  try{expect(()=>applyShellIntegration(f.kiro,f.initialPlan,{expectedOwner:f.core.owner})).toThrow(/busy/);expect(fs.readFileSync(f.file)).toEqual(before);}finally{unlock();}
 });
 it('explicit null admits only an absent-core removal; two-argument API remains usable',()=>{
  const f=fixture();f.install();const removal=f.plan(true);
  expect(()=>applyShellIntegration(f.kiro,removal,{expectedOwner:null})).toThrow(/superseded/);
  fs.unlinkSync(path.join(f.kiro,'agents/kiro-fabric.json'));
  expect(applyShellIntegration(f.kiro,removal,{expectedOwner:null}).status).toBe('removed');
 });
});

describe("automatic installer shell handoff", () => {
  it.for(["bash", "zsh"])("runs ordinary kiro-cli --v3 in %s with per-project paths and preserved argv/exit", (shell, context) => {
    const f = fixture(shell); f.install();
    const executable = (shell === "bash" ? ["/bin/bash"] : ["/bin/zsh", "/usr/bin/zsh"]).find(file => fs.existsSync(file));
    if (!executable) { context.skip(); return; }
    const run = (cwd: string, args: string[]) => spawnSync(executable, [shell === "bash" ? "--norc" : "-f", "-c", '. "$HOME/.' + (shell === "bash" ? "bashrc" : "zshrc") + '"; kiro-cli "$@"', "fixture", ...args], { cwd, env: f.env, encoding: "utf8" });
    for (const name of ["project a", "project ' ü"]) {
      const project = path.join(f.root, name); fs.mkdirSync(project, { mode: 0o700 });
      const result = run(project, ["--v3", "chat", "hello world"]);
      expect(result.stderr).toBe(""); expect(result.status).toBe(23);
      expect(result.stdout.trim().split("\n")).toEqual([project, f.kiro, "--agent", "kiro-fabric", "--v3", "chat", "hello world"]);
      for (const selection of [["--agent", "other"], ["--agent=other"], ["-a", "other"], ["-aother"]]) {
        const selected = run(project, ["--v3", ...selection]);
        expect(selected.status).toBe(23);
        expect(selected.stdout.trim().split("\n")).toEqual([project, "/caller-home", "--v3", ...selection]);
      }
      const terminated = run(project, ["--v3", "--", "--agent=prompt-text"]);
      expect(terminated.stdout.trim().split("\n")).toEqual([project, f.kiro, "--agent", "kiro-fabric", "--v3", "--", "--agent=prompt-text"]);
      const native = run(project, ["--version"]);
      expect(native.stdout.trim().split("\n")).toEqual(["unset", "/caller-home", "--version"]);
    }
    // A fresh interactive terminal must discover the managed rc itself: no source command.
    const terminal = spawnSync(executable, [shell === "bash" ? "--noprofile" : "-d", "-ic", "kiro-cli --v3"], { cwd: f.root, env: f.env, encoding: "utf8" });
    expect(terminal.status, terminal.stderr).toBe(23);
    expect(terminal.stdout.trim().split("\n")).toEqual([f.root, f.kiro, "--agent", "kiro-fabric", "--v3"]);
    fs.unlinkSync(path.join(f.kiro, "agents/kiro-fabric.json"));
    expect(run(f.root, ["--v3"]).stdout.trim().split("\n")).toEqual(["unset", "/caller-home", "--v3"]);
  });
  it("backs up once, updates idempotently, and removes only its own block", () => {
    const original = "export MY_SETTING=kept\n", f = fixture("bash", original);
    const planned = f.plan(); expect(fs.readFileSync(f.file, "utf8")).toBe(original);
    const installed = applyShellIntegration(f.kiro, planned);
    expect(fs.readFileSync(installed.backup!, "utf8")).toBe(original);
    const first = fs.readFileSync(f.file, "utf8");
    expect(f.install().backup).toBe(installed.backup);
    expect(fs.readFileSync(f.file, "utf8")).toBe(first);
    fs.appendFileSync(f.file, "# later user change\n");
    f.install();
    expect(applyShellIntegration(f.kiro, f.plan(true)).status).toBe("removed");
    expect(fs.readFileSync(f.file, "utf8")).toBe(original + "# later user change\n");
    expect(fs.readFileSync(installed.backup!, "utf8")).toBe(original);
    expect(f.plan(true).status).toBe("skipped");
  });
  it("removes an originally absent rc only if no user content was added", () => {
    const f = fixture("bash", null); f.install(); applyShellIntegration(f.kiro, f.plan(true));
    expect(fs.existsSync(f.file)).toBe(false);
  });
  it.each(["alias kiro-cli='other'", "kiro-cli() { :; }", "function kiro-cli { :; }", "# >>> kiro-fabric workspace handoff v1\nchanged"])("preserves conflicting configuration: %s", original => {
    const f = fixture("bash", original);
    expect(() => f.plan()).toThrow(/preserved/);
    expect(fs.readFileSync(f.file, "utf8")).toBe(original);
    expect(fs.readdirSync(path.join(f.kiro, "kiro-fabric"))).toEqual([]);
  });
  it.each(["symlink", "hardlink", "writable", "changed after plan", "modified managed block"])("fails closed for %s", kind => {
    const f = fixture(), plan = f.plan();
    if (kind === "symlink") { fs.renameSync(f.file, f.file + ".original"); fs.symlinkSync(f.file + ".original", f.file); }
    if (kind === "hardlink") fs.linkSync(f.file, f.file + ".linked");
    if (kind === "writable") fs.chmodSync(f.file, 0o666);
    if (kind === "changed after plan") fs.appendFileSync(f.file, "\n# changed");
    if (kind === "modified managed block") { f.install(); fs.writeFileSync(f.file, fs.readFileSync(f.file, "utf8").replace("fabric_v3=0", "fabric_v3=1")); }
    const before = fs.readFileSync(f.file);
    expect(() => kind === "modified managed block" ? f.plan(true) : applyShellIntegration(f.kiro, plan)).toThrow();
    expect(fs.readFileSync(f.file)).toEqual(before);
  });
  it("recovers a recorded install interrupted before appending rc", () => {
    const f = fixture(), original = fs.readFileSync(f.file); f.install();
    fs.writeFileSync(f.file, original);
    expect(f.install().status).toBe("configured");
    expect(fs.readFileSync(f.file, "utf8")).toContain("KIRO_FABRIC_LAUNCH_WORKSPACE");
  });
  it("refuses a second Kiro home claiming the same startup file", () => {
    const f = fixture(); f.install();
    const other = path.join(f.home, "other kiro"); fs.mkdirSync(other, { mode: 0o700 });
    expect(() => planShellIntegration(other, { env: f.env })).toThrow(/Unowned or modified/);
  });
  it("recovers removal interrupted after preserving later user edits", () => {
    const f = fixture(); f.install(); fs.appendFileSync(f.file, "# later edit\n");
    const plan = f.plan(true), state = path.join(f.kiro, "kiro-fabric/shell-integration.json");
    const saved = JSON.parse(fs.readFileSync(state, "utf8"));
    // Emulate a crash after rc publication but before the ownership record is removed.
    saved.removalSha256 = createHash("sha256").update(plan.next!).digest("hex");
    fs.writeFileSync(state, JSON.stringify(saved)); fs.writeFileSync(f.file, plan.next!);
    expect(applyShellIntegration(f.kiro, f.plan(true)).status).toBe("removed");
    expect(fs.readFileSync(f.file, "utf8")).toBe(plan.next);
  });
  it("honors ZDOTDIR, opt-out and unsupported shells without guessing", () => {
    const f = fixture("zsh"), dot = path.join(f.home, "dotfiles"); fs.mkdirSync(dot, { mode: 0o700 });
    const plan = planShellIntegration(f.kiro, { env: { ...f.env, ZDOTDIR: dot } });
    expect(plan.file).toBe(path.join(dot, ".zshrc"));
    expect(planShellIntegration(f.kiro, { env: f.env, disabled: true }).status).toBe("skipped");
    for (const SHELL of ["", "/bin/fish"]) expect(planShellIntegration(f.kiro, { env: { ...f.env, SHELL } }).status).toBe("skipped");
    expect(() => planShellIntegration(f.kiro, { env: { ...f.env, ZDOTDIR: "relative" } })).toThrow(/safe|absolute/i);
    for (const command of ["install", "update", "uninstall"]) expect(parseManagerArguments([command, "--no-shell-integration"]).noShellIntegration).toBe(true);
    for (const command of ["doctor", "start", "restore", "rollback"]) expect(() => parseManagerArguments([command, "--no-shell-integration"])).toThrow();
  });
});
