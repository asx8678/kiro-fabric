const evidence = await fabric.git.diff({ maxChars: 18000 });
const roles = ["correctness reviewer", "security reviewer", "validation reviewer"];
const reports = await fabric.ai.map({
  items: roles,
  concurrency: 3,
  createTask: (role) => ({
    role: "worker" as const,
    instruction: `${role}: independently inspect the diff. Do not delegate. Cite path and exact quote; agreement is not proof.`,
    context: evidence,
    outputSchema: {
      type: "object",
      properties: {
        findings: { type: "array" },
        status: { enum: ["unverified", "verified", "failed"] },
      },
      required: ["findings", "status"],
      additionalProperties: false,
    },
  }),
});
const successful = reports.filter((report) => report.value !== undefined);
if (successful.length === 0) return { status: "failed", reports };
return { status: successful.length === reports.length ? "succeeded" : "partial", reports };
