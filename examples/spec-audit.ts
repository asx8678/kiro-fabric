const requirements = ["typecheck", "tests", "build"];
const files = await fabric.fs.grep({
  query: "typecheck|test|build",
  paths: ["package.json"],
  maxMatches: 30,
});
const audit = await fabric.ai.run({
  role: "verifier",
  instruction:
    "One-shot audit. Mark satisfied only with path/line/quote evidence and an observed requested validation result. Unrun validation is unverified; do not certify.",
  context: { requirements, files, validation: "not run by this read-only example" },
  outputSchema: {
    type: "object",
    properties: {
      status: { enum: ["succeeded", "partial", "failed"] },
      requirements: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            status: { enum: ["unverified", "verified", "failed"] },
            evidence: { type: "array" },
          },
          required: ["id", "status", "evidence"],
          additionalProperties: false,
        },
      },
    },
    required: ["status", "requirements"],
    additionalProperties: false,
  },
});
return audit;
