const criteria = [
  "correctness and failure modes",
  "operational simplicity",
  "security and least privilege",
];
const reviews = await fabric.ai.map({
  items: criteria,
  concurrency: 3,
  createTask: (criterion) => ({
    instruction: `Compare the proposed designs only on ${criterion}. Record evidence and uncertainty.`,
    context: { designA: "Insert design A", designB: "Insert design B" },
    outputSchema: {
      type: "object",
      properties: {
        preferred: { enum: ["A", "B", "tie"] },
        reasons: { type: "array", items: { type: "string" } },
      },
      required: ["preferred", "reasons"],
      additionalProperties: false,
    },
  }),
});
return reviews;
