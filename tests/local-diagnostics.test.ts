import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { normalizeFabricConfig } from "../src/config.js";
import { ActionRegistry } from "../src/core/action-registry.js";
import { FabricExecutionService } from "../src/execution-service.js";
import { LocalCodingProvider } from "../src/providers/local-provider.js";
import { projectFabricExecutionText } from "../src/kiro/projection.js";
import { runLocalShell } from "../src/providers/local-shell.js";

const fixtures: { base: string; service: FabricExecutionService }[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const f of fixtures.splice(0)) { await f.service.close(); fs.rmSync(f.base, { recursive: true, force: true }); } });
function fixture(budget = 20000) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "fabric-diagnostics-"))); const root = path.join(base, "workspace"); fs.mkdirSync(root);
  const registry = new ActionRegistry(); registry.register(new LocalCodingProvider({ root, lockRoot: path.join(base, "locks"), maxResultChars: budget }));
  const service = new FabricExecutionService(registry, normalizeFabricConfig({ executor: { timeoutMs: 5000, maxNestedResultChars: budget } }), root);
  fixtures.push({ base, service }); return { base, root, service };
}
const approve = { async approve() {} };
const project = (result: Awaited<ReturnType<FabricExecutionService["execute"]>>, maxOutputChars = 20000) => projectFabricExecutionText({ result, resultFormat: "json", maxOutputChars, writeArtifact: () => "diagnostic-artifact" });
it("preserves ordinary nonzero output through checked guest, registry, service and projection", async () => {
  const { service } = fixture();
  const result = await service.execute({ code: 'return await local.shell({command:"printf compiler-start; printf TYPE_ERROR >&2; exit 7"});', approver: approve });
  expect(result.status).toBe("failed"); expect(result.lastShellFailure).toMatchObject({ exitCode: 7, stdout: "compiler-start", stderr: "TYPE_ERROR", stdoutTruncated: false, stderrTruncated: false });
  expect(project(result).text).toContain("TYPE_ERROR"); expect(result.error).not.toContain("TYPE_ERROR"); expect(JSON.stringify(result.audits)).not.toContain("TYPE_ERROR");
  const caught = await service.execute({ code: 'try { await local.shell({command:"printf CAUGHT >&2; exit 1"}); } catch (error) { if (error instanceof Error && error.result) return error.result; throw error; } return null;', approver: approve });
  expect(caught.status).toBe("succeeded"); expect(caught.value).toMatchObject({ exitCode: 1, stderr: "CAUGHT" });
});
it.each([256, 512, 1024, 20000])("retains deterministic head/tail within %i JSON characters", async (budget) => {
  const { root } = fixture();
  const result = await runLocalShell({ cwd: root, command: "printf HEAD; head -c 100000 /dev/zero; printf TAIL; printf START >&2; head -c 100000 /dev/zero >&2; printf ERROR_END >&2; exit 1", settle: true, maxOutputChars: budget });
  expect(JSON.stringify(result).length).toBeLessThanOrEqual(budget); expect(result.stdoutTruncated).toBe(true); expect(result.stderrTruncated).toBe(true);
  if (budget >= 1024) { expect(result.stdout).toMatch(/^HEAD/); expect(result.stdout).toMatch(/TAIL$/); expect(result.stderr).toMatch(/^START/); expect(result.stderr).toMatch(/ERROR_END$/); }
});
it("retains tail diagnostics in projected output and an existing overflow artifact", async () => {
  const { service } = fixture(1024);
  const result = await service.execute({ code: 'return await local.shell({command:"printf HEAD; head -c 100000 /dev/zero; printf TAIL_ERROR >&2; exit 1"});', approver: approve });
  expect(result.lastShellFailure?.stderr).toBe("TAIL_ERROR"); expect(project(result).text).toContain("TAIL_ERROR");
  const small = project(result, 256); expect(small.text.length).toBeLessThanOrEqual(256); expect(small.artifactId).toBe("diagnostic-artifact");
});
it("hard shell failures and denial never masquerade as ordinary nonzero diagnostics", async () => {
  const { service } = fixture();
  for (const code of ['return await local.shell({command:"kill -TERM $$",settle:true});', 'return await local.shell({command:"sleep 60",timeoutMs:5,settle:true});']) {
    const result = await service.execute({ code, approver: approve }); expect(result.success).toBe(false); expect(result.lastShellFailure).toBeUndefined();
  }
  const denied = await service.execute({ code: 'return await local.shell({command:"touch forbidden"});', approver: { async approve() { throw new Error("denied"); } } });
  expect(denied.success).toBe(false); expect(denied.lastShellFailure).toBeUndefined();
});
it.each(["write", "edit"] as const)("%s commit acknowledgement survives cleanup and outer cancellation without content leakage", async (operation) => {
  const { base, root, service } = fixture(); fs.writeFileSync(path.join(root, "target"), "PRIVATE-old");
  const controller = new AbortController(); const rename = fs.renameSync;
  vi.spyOn(fs, "renameSync").mockImplementation((from, to) => { rename(from, to); if (String(to) === path.join(root, "target")) controller.abort(new Error("PRIVATE cause")); });
  const code = operation === "write" ? 'return await local.write({path:"target",content:"PRIVATE-new",overwrite:true,expectedSha256:payloads.sha256});' : 'return await local.edit({path:"target",oldText:"PRIVATE-old",newText:"PRIVATE-new",expectedSha256:payloads.sha256});';
  const result = await service.execute({ code, payloads: { sha256: createHash("sha256").update("PRIVATE-old").digest("hex") }, approver: approve, signal: controller.signal });
  expect(result.status).toBe("aborted"); expect(result.audits[0]?.commitAcknowledgement).toEqual({ version: 1, operation });
  expect(project(result).text).toContain("known committed"); expect(project(result).text).not.toContain("PRIVATE"); expect(fs.readFileSync(path.join(root, "target"), "utf8")).toBe("PRIVATE-new");
  expect(fs.readdirSync(path.join(base, "locks"))).toEqual([]);
});
