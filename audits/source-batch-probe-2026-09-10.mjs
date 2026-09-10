// Read-only retrieval measurement of the source groups seen in the supplied review.
// Usage: node audits/source-batch-probe-2026-09-10.mjs <dist/index.js> <reviewed-checkout>
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

const [library, checkout] = process.argv.slice(2);
assert.ok(library && checkout, "Supply the built library and reviewed checkout");
const { createKiroRuntime, normalizeFabricConfig } = await import(pathToFileURL(path.resolve(library)).href);
const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "fabric-source-batch-probe-")));
const root = fs.realpathSync(checkout);
const runtime = createKiroRuntime({
  cwd: root, workspaceRoot: root, localLockRoot: path.join(base, "locks"),
  artifactsRoot: path.join(base, "artifacts"), configFile: path.join(base, "config.json"), mcpConfigPath: path.join(base, "mcp.json"),
  config: normalizeFabricConfig({ executor: { timeoutMs: 10000 }, mcp: { enabled: false }, memory: { enabled: false }, state: { enabled: false } }),
});
const groups = {
  entrypoints: ["README.md", "azure-pipelines.yml", "docker-compose.yml", ".azure-pipelines/security-monitor-deploy.yml"],
  chart: ["helm/pau-security-monitor/values.yaml", "helm/pau-security-monitor/templates/_podtemplatespec.tpl", "helm/pau-security-monitor/templates/configmap.yaml", "helm/pau-security-monitor/templates/secret.yaml"],
  maintenance: [".azure-pipelines/helm-chart-test.yml", "nightly-cleanup-pipeline.yml", ".azure-pipelines/deletion-of-outdated-CVEs.yml", ".azure-pipelines/removeObsoleteArtifacts.ps1"],
  cron: ["configurations/common/deployment.yaml", "configurations/envs/prod/deployment.yaml", "configurations/envs/staging/deployment.yaml", "helm/pau-security-monitor/templates/servicecallingcronjobs.yaml"],
};
const sha = text => createHash("sha256").update(text).digest("hex");
const results = {};
try {
  for (const [group, paths] of Object.entries(groups)) {
    let windows = paths.map(file => ({ path: file, limit: 2000 }));
    const expected = paths.map(file => {
      const text = fs.readFileSync(path.join(root, file), "utf8");
      const lines = text.split(/\r?\n/u); if (text.endsWith("\n")) lines.pop();
      assert.ok(lines.length <= 2000);
      return [file, { hash: sha(text), source: lines.map((line, i) => `${i + 1}: ${line}`).join("\n") }];
    });
    const received = new Map();
    const pages = [];
    while (windows.length) {
      assert.ok(pages.length < 20, "Continuation made no bounded progress");
      const result = await runtime.service.execute({
        code: "return await local.readMany({windows:JSON.parse(payloads.windows) as LocalReadWindow[]});",
        payloads: { windows: JSON.stringify(windows) },
        approver: {
          prepareApproval(action) { assert.equal(action.risk, "read"); return { decision: "allow" }; },
          async approve() { throw new Error("Unexpected effect approval"); },
        },
      });
      assert.ok(result.success, result.error);
      assert.deepEqual(result.audits.map(a => a.ref), ["local.readMany"]);
      const page = result.value;
      const chars = JSON.stringify(page).length;
      assert.ok(chars <= runtime.service.config.executor.maxOutputChars, "Visible compact result would overflow");
      pages.push({ chars, files: page.files.map(file => ({ path: file.path, startLine: file.startLine, endLine: file.endLine })) });
      for (const file of page.files) {
        const prior = received.get(file.path);
        assert.ok(!prior || prior.hash === file.sha256, "Different snapshots joined");
        received.set(file.path, { hash: file.sha256, source: prior ? prior.source + "\n" + file.source : file.source });
      }
      windows = page.remaining;
    }
    assert.deepEqual([...received], expected, "Source missing, duplicated or changed");
    for (const [file, snapshot] of expected) assert.equal(sha(fs.readFileSync(path.join(root, file), "utf8")), snapshot.hash, "Checkout changed during measurement");
    results[group] = { calls: pages.length, pages, files: expected.map(([file, value]) => ({ path: file, sha256: value.hash })), evidenceComplete: true };
  }
  console.log(JSON.stringify({ inferenceRequests: 0, sourceOnly: true, results }, null, 2));
} finally {
  await runtime.close();
  fs.rmSync(base, { recursive: true, force: true });
}
