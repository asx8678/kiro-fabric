const context = await fabric.fs.grep({ query: "test|expect|assert", glob: "test/**/*.ts", maxMatches: 80, contextLines: 2 });
const diagnosis = await fabric.ai.run({
  instruction: "Diagnose the supplied failing-test evidence. Separate root cause from symptoms and propose the smallest checkable fix.",
  context,
  outputSchema: { type: "object", properties: { rootCause: { type: "string" }, evidence: { type: "array", items: { type: "string" } }, fix: { type: "string" } }, required: ["rootCause", "evidence", "fix"], additionalProperties: false }
});
return diagnosis;