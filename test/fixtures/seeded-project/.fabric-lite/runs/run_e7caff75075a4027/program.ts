const files = await fabric.fs.readMany({ paths: ["src/pricing.ts", "test/pricing.failing.ts"] });
const result = await fabric.ai.run({ instruction: "Diagnose the seeded failing test. Identify whether implementation or expectation is wrong and cite exact evidence.", context: files, role: "worker", outputSchema: {type:"object",properties:{cause:{type:"string"},smallestFix:{type:"string"},evidence:{type:"string"}},required:["cause","smallestFix","evidence"],additionalProperties:false} });
return result.value;
