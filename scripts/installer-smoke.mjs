import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { randomBytes } from "node:crypto";
import { validateBundle } from "./bundle-contract.mjs";
import { assertInstallerSmokeResult, installerSmokeInput } from "./installer-smoke-contract.mjs";

export async function smokeCandidate(bundleRoot) {
  const bundle = await validateBundle(bundleRoot);
  const node = path.join(bundle.root, "tools", "node"), rg = path.join(bundle.root, "tools", "rg");
  const version = (executable, args, expected) => {
    const probe = spawnSync(executable, args, { env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" }, encoding: "utf8", timeout: 5000, maxBuffer: 4096, stdio: ["ignore", "pipe", "pipe"] });
    if (probe.error || probe.status !== 0 || !probe.stdout.startsWith(expected)) throw new Error(`Candidate private ${path.basename(executable)} version/compatibility check failed`);
  };
  version(node, ["--version"], `v${bundle.manifest.tools.node.version}\n`);
  version(rg, ["--no-config", "--version"], `ripgrep ${bundle.manifest.tools.rg.version}`);
  const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "fabric-candidate-smoke-")));
  fs.chmodSync(temporary, 0o700);
  const workspace = path.join(temporary, "workspace"), data = path.join(temporary, "data"), home = path.join(temporary, "home");
  for (const dir of [workspace, data, home]) fs.mkdirSync(dir, { mode: 0o700 });
  const sentinel = `fabric-smoke-${randomBytes(12).toString("hex")}`;
  fs.writeFileSync(path.join(workspace, "probe.txt"), `${sentinel}\n`, { mode: 0o600 });
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(node, [path.join(bundle.root, "app", "kiro", "mcp-entry.js")], { cwd: workspace,
        env: { HOME: home, KIRO_HOME: path.join(home, ".kiro"), PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C", KIRO_FABRIC_BUNDLE_ROOT: bundle.root, KIRO_FABRIC_RUNTIME_ROOT: path.join(bundle.root, "app"), KIRO_FABRIC_EXPECTED_NODE: node, KIRO_FABRIC_RG: rg, KIRO_FABRIC_DATA_ROOT: data }, stdio: ["pipe", "pipe", "pipe"] });
      let buffer = "", diagnostic = "", passed = false, failure, expectedResponse = 1;
      const fail = (error) => { failure ??= error; child.kill("SIGTERM"); };
      const timer = setTimeout(() => fail(new Error("Candidate backend smoke timed out")), 30000);
      const killer = setTimeout(() => child.kill("SIGKILL"), 33000);
      const send = frame => { if (!child.stdin.destroyed) child.stdin.write(`${JSON.stringify(frame)}\n`); };
      child.stdin.on("error", error => fail(error));
      child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
      child.stderr.on("data", chunk => { diagnostic = (diagnostic + chunk).slice(-4000); });
      child.stdout.on("data", chunk => {
        buffer += chunk;
        if (buffer.length > 1024 * 1024) { fail(new Error("Candidate smoke output exceeded bound")); return; }
        while (buffer.includes("\n")) {
          const end = buffer.indexOf("\n"), line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
          if (!line.trim()) continue;
          let frame;
          try { frame = JSON.parse(line); } catch { fail(new Error("Invalid backend JSON during smoke")); return; }
          if (frame.id !== undefined && frame.method === undefined && frame.id !== expectedResponse) { fail(new Error("Candidate smoke response out of order")); return; }
          if (frame.method === "roots/list") send({ jsonrpc: "2.0", id: frame.id, result: { roots: [{ uri: pathToFileURL(workspace).href, name: "installer-fixture" }] } });
          else if (frame.method === "elicitation/create") send({ jsonrpc: "2.0", id: frame.id, result: { action: "decline" } });
          else if (frame.id === 1 && !frame.method) {
            if (frame.error || !frame.result || typeof frame.result !== "object") { fail(new Error("Candidate initialization failed")); return; }
            expectedResponse = 2;
            send({ jsonrpc: "2.0", method: "notifications/initialized" }); send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
          } else if (frame.id === 2 && !frame.method) {
            const names = frame.result?.tools?.map(tool => tool.name).sort();
            if (frame.error || frame.result?.isError || JSON.stringify(names) !== JSON.stringify(["fabric_exec", "fabric_info", "fabric_workspace"])) { fail(new Error("Candidate raw backend inventory mismatch")); return; }
            expectedResponse = 3;
            send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "fabric_exec", arguments: installerSmokeInput(sentinel) } });
          } else if (frame.id === 3 && !frame.method) {
            try { assertInstallerSmokeResult(frame, sentinel); expectedResponse = 4; passed = true; child.stdin.end(); }
            catch (error) { fail(error); }
          }
        }
      });
      child.once("error", error => { clearTimeout(timer); clearTimeout(killer); reject(error); });
      child.once("close", code => { clearTimeout(timer); clearTimeout(killer); if (failure || !passed || code !== 0) reject(failure ?? new Error(`Candidate shutdown failed (${code}): ${diagnostic.replace(/[\u0000-\u001f\u007f]/gu, " ")}`)); else resolve(undefined); });
      send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: { roots: {}, elicitation: { form: {} } }, clientInfo: { name: "fabric-installer-smoke", version: "1" } } });
    });
    return { integrity: "PASS", privateTools: "PASS", backend: "PASS", authenticatedKiro: "NOT TESTED" };
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}
