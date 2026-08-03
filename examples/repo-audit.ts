const candidates = await fabric.fs.grep({ query: "TODO|FIXME|throw new Error", glob: "src/**/*.ts", maxMatches: 100 });
const batches = fabric.util.chunk(candidates.files, 4);
const findings = await fabric.ai.parallel({
  tasks: await Promise.all(batches.slice(0, 5).map(async paths => ({
    role: "worker" as const,
    instruction: "Find concrete correctness defects. Cite file-specific evidence; do not speculate.",
    context: await fabric.fs.readMany({ paths, maxCharsPerFile: 12000 }),
    outputSchema: { type: "object", properties: { findings: { type: "array" } }, required: ["findings"], additionalProperties: false }
  }))), concurrency: 3
});
return { coverage: candidates.files, findings };