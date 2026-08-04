import { describe,it,expect } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
const cli="dist/cli/main.js";
describe("built CLI",()=>{it("checks and executes deterministic bodies",()=>{const check=spawnSync(process.execPath,[cli,"check","--format","json"],{input:"return {ok:true};",encoding:"utf8"});expect(check.status).toBe(0);expect(JSON.parse(check.stdout).status).toBe("valid");const atomic=spawnSync(process.execPath,[cli,"run","--format","json"],{input:"return {atomic:true};",encoding:"utf8"});expect(atomic.status).toBe(0);expect(JSON.parse(atomic.stdout)).toMatchObject({status:"succeeded",value:{atomic:true}});const invalid=spawnSync(process.execPath,[cli,"run","--format","json"],{input:"const x: string = 1; return x;",encoding:"utf8"});expect(invalid.status).toBe(2);expect(JSON.parse(invalid.stdout).error.code).toBe("TYPECHECK_FAILED");const run=spawnSync(process.execPath,[cli,"exec","--format","json"],{input:"return {ok: fabric.util.unique([1,1,2])};",encoding:"utf8"});expect(run.status).toBe(0);expect(JSON.parse(run.stdout)).toMatchObject({status:"succeeded",value:{ok:[1,2]}});const noisy=spawnSync(process.execPath,[cli,"exec","--format","json"],{input:'console.log("guest diagnostic"); process.stdout.write("guest stdout"); return {ok:true};',encoding:"utf8"});expect(noisy.status).toBe(0);expect(JSON.parse(noisy.stdout)).toMatchObject({status:"succeeded",value:{ok:true}});expect(noisy.stderr).toContain("guest diagnostic");expect(noisy.stderr).toContain("guest stdout");});it("returns structured runtime errors for non-JSON final values",()=>{for(const [body,detail] of [["return undefined;","undefined"],["return 1n;","bigint"],["const value: {self?: unknown} = {}; value.self = value; return value;","cyclic"],["return NaN;","non-finite"]] as const){const run=spawnSync(process.execPath,[cli,"exec","--format","json"],{input:body,encoding:"utf8"});expect(run.status,body).toBe(1);expect(JSON.parse(run.stdout),body).toMatchObject({status:"failed",error:{code:"RUNTIME_FAILED"}});expect(run.stdout,body).toContain(detail);}});

  it("forwards filtered Kiro auth env without leaking values",()=>{const root=mkdtempSync(path.join(tmpdir(),"fabric-env-"));try{const runner=path.join(root,"fake-kiro");writeFileSync(runner,'#!/usr/bin/env node\nif (!process.env.KIRO_API_KEY) process.exit(9); process.stdout.write(`FABRIC_RESULT_BEGIN\\n{"authenticated":true}\\nFABRIC_RESULT_END`);');chmodSync(runner,0o755);mkdirSync(path.join(root,".fabric-lite"));writeFileSync(path.join(root,".fabric-lite/config.json"),JSON.stringify({version:1,projectRoot:".",runner:{type:"kiro-headless",executable:runner,workerAgent:"fabric-lite-worker",defaultModel:null}}));const run=spawnSync(process.execPath,[path.resolve(cli),"exec","--cwd",root,"--format","json"],{input:'return await fabric.ai.run({instruction:"auth", outputSchema:{type:"object",required:["authenticated"]}});',encoding:"utf8",env:{...process.env,KIRO_API_KEY:"seeded-do-not-log"}});expect(run.status).toBe(0);expect(JSON.parse(run.stdout)).toMatchObject({status:"succeeded",value:{value:{authenticated:true}}});expect(run.stdout+run.stderr).not.toContain("seeded-do-not-log");}finally{rmSync(root,{recursive:true,force:true});}});

  it("bounds piped programs at the checker limit", () => {
    const run = spawnSync(process.execPath, [cli, "check", "--format", "json"], {
      input: "x".repeat(100_001),
      encoding: "utf8",
    });
    expect(run.status).toBe(2);
    expect(JSON.parse(run.stdout)).toMatchObject({
      status: "failed",
      error: { code: "TYPECHECK_FAILED" },
    });
    expect(run.stdout).toContain("Program exceeds 100000 characters while reading input");
  });

  it("formats top-level errors using the parsed output format", () => {
    const missing = path.join(tmpdir(), "fabric-definitely-missing-program.ts");
    const json = spawnSync(
      process.execPath,
      [cli, "check", "--file", missing, "--format", "json"],
      { encoding: "utf8" },
    );
    expect(json.status).toBe(3);
    const parsed = JSON.parse(json.stdout);
    expect(parsed).toMatchObject({ status: "failed", error: { code: "RUNTIME_FAILED" } });
    expect(json.stdout).toBe(`${JSON.stringify(parsed)}\n`);

    const parseError = spawnSync(
      process.execPath,
      [cli, "check", "--format", "json", "--unknown"],
      { encoding: "utf8" },
    );
    expect(parseError.status).toBe(3);
    const parsedError = JSON.parse(parseError.stdout);
    expect(parsedError.error.message).toContain("Unknown option");
    expect(parseError.stdout).toBe(`${JSON.stringify(parsedError)}\n`);

    const text = spawnSync(
      process.execPath,
      [cli, "check", "--file", missing, "--format", "text"],
      { encoding: "utf8" },
    );
    expect(text.status).toBe(3);
    expect(text.stdout).toContain("\n  \"status\": \"failed\"");
  });

  it("rejects unsupported and missing format values", () => {
    for (const args of [["check", "--format", "yaml"], ["check", "--format"]]) {
      const run = spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });
      expect(run.status).toBe(3);
      expect(run.stdout).toMatch(/format/);
    }
  });
});