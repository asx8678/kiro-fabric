import { discounted, total } from "../src/pricing.ts";

// Seeded evidence for deterministic audit/diagnosis scenarios.
if (total([125, 75]) !== 200) throw new Error("total regression");
if (discounted(1000, 10) !== 900) throw new Error("discount regression");