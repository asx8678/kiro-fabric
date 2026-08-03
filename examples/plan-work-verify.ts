const files = await fabric.git.changedFiles({ includeUntracked: true });
const tasks = fabric.util.chunk(files, 4).slice(0, 5);
const reports = await fabric.ai.parallel({ tasks: await Promise.all(tasks.map(async paths => ({ role: "worker" as const, instruction: "Review for concrete regressions and cite evidence.", context: await fabric.fs.readMany({ paths }) }))), concurrency: 3 });
const verified = await fabric.ai.run({ role: "verifier", instruction: "Deduplicate findings, reject unsupported claims, and state incomplete coverage.", context: reports, outputSchema: { type: "object", properties: { findings: { type: "array" }, incomplete: { type: "boolean" } }, required: ["findings", "incomplete"], additionalProperties: false } });
return verified;