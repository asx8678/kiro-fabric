// Private runner entrypoint. Executes existing fixed cases; contains no cases.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadSuite } from "../verify-offline.mjs";
import { createSpawn } from "./runner.mjs";
import { validateCaseRegistry } from "./case-contract.mjs";
import { enterCaseProcessGroup } from "./case-process.mjs";

const ROOT = fs.realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.."));
const keepAlive = setInterval(() => {}, 1000);
let request;
try {
  if (process.argv.length !== 3) throw new Error("case worker requires one fixed request");
  request = JSON.parse(process.argv[2]);
  if (!request || request.root !== ROOT || !Number.isSafeInteger(request.deadlineMs) || request.deadlineMs < 1 || request.deadlineMs > 900000) throw new Error("invalid case worker request");
  enterCaseProcessGroup(request.nested);
  const loaded = await loadSuite(request.suite);
  if (loaded.problem) throw new Error(loaded.problem);
  const contract = validateCaseRegistry(loaded.name, loaded.cases, loaded.requiredIds);
  if (contract.problems.length) throw new Error(contract.problems.join("; "));
  if (request.mode !== undefined && request.mode !== "inspect") throw new Error("unknown worker mode");
  const entry = loaded.cases.find(candidate => candidate.id === request.caseId);
  if (request.mode !== "inspect" && (!entry || typeof entry.run !== "function" || entry.unavailable !== undefined)) throw new Error("case is unavailable: " + request.caseId);
  const root = request.fixturesRoot;
  const stat = fs.lstatSync(root);
  if (fs.realpathSync(root) !== root || !stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid?.() || (stat.mode & 0o077)) throw new Error("unsafe case fixture root");
  const facts = request.mode === "inspect" ? {
    requiredIds: loaded.requiredIds,
    cases: loaded.cases.map(item => ({ id: item.id, title: item.title, deadlineMs: item.deadlineMs,
      effects: item.effects, unavailable: item.unavailable, implemented: typeof item.run === "function" })),
  } : await entry.run({
    root: ROOT, caseId: request.caseId, fixturesRoot: root, retainedRoot: root,
    deadlineMs: request.deadlineMs,
    spawn: createSpawn({ cwd: ROOT, env: { ...process.env }, timeoutMs: request.deadlineMs }),
    stderr: text => process.stderr.write(text),
  });
  process.stdout.write(JSON.stringify({ schemaVersion: 1, caseId: request.caseId, facts }) + "\n");
} catch (error) {
  process.stderr.write((error instanceof Error ? error.stack ?? error.message : String(error)) + "\n");
  process.exitCode = 1;
} finally {
  clearInterval(keepAlive);
}
