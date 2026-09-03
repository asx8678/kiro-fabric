import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { installUserAgent, uninstallUserAgent } from "../scripts/install-agent-user.mjs";
import { validateAgentPackage } from "../scripts/validate-agent-package.mjs";

const roots:string[]=[];const temporary=()=>{const r=fs.mkdtempSync(path.join(os.tmpdir(),"fabric-agent-安装-"));roots.push(r);return r};
afterEach(()=>{for(const r of roots.splice(0))fs.rmSync(r,{recursive:true,force:true})});
describe("user-global Agent installation",()=>{
 it("installs idempotently with absolute paths and preserves data on uninstall",()=>{const root=temporary(),kiroHome=path.join(root,"Kiro Home");fs.mkdirSync(kiroHome,{mode:0o700});const env={KIRO_HOME:kiroHome};const first=installUserAgent(".tmp/kiro-fabric-agent",env,root);expect(validateAgentPackage(".tmp/kiro-fabric-agent").digest).toBe(first.packageDigest);const profile=JSON.parse(fs.readFileSync(first.profile,"utf8"));expect(profile.name).toBe("kiro-fabric");expect(profile.includePowers).toBe(false);expect(profile.includeMcpJson).toBe(false);expect(profile.tools).toEqual(["read","write","shell","web","subagent","todo_list","@fabric"]);expect(Object.keys(profile.mcpServers)).toEqual(["fabric"]);expect(profile.mcpServers.fabric.env.PLUGIN_ROOT).toBeUndefined();expect(profile.mcpServers.fabric.env.KIRO_FABRIC_DATA_ROOT).toBe(first.data);expect(installUserAgent(".tmp/kiro-fabric-agent",env,root).packageDigest).toBe(first.packageDigest);const removed=uninstallUserAgent(env,root);expect(removed.dataPreserved).toBe(true);expect(fs.existsSync(first.data)).toBe(true)});
 it("refuses unowned and modified profiles",()=>{const root=temporary(),kiroHome=path.join(root,".kiro");fs.mkdirSync(path.join(kiroHome,"agents"),{recursive:true,mode:0o700});fs.writeFileSync(path.join(kiroHome,"agents","kiro-fabric.json"),"{}",{mode:0o600});expect(()=>installUserAgent(".tmp/kiro-fabric-agent",{KIRO_HOME:kiroHome},root)).toThrow("unowned profile")});
 it("does not create Power registries or global steering",()=>{const root=temporary(),kiroHome=path.join(root,".kiro");fs.mkdirSync(kiroHome,{mode:0o700});installUserAgent(".tmp/kiro-fabric-agent",{KIRO_HOME:kiroHome},root);expect(fs.existsSync(path.join(kiroHome,"powers"))).toBe(false);expect(fs.existsSync(path.join(kiroHome,"steering"))).toBe(false)});
});
