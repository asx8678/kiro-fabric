import { discounted } from "../src/pricing.ts";

// Seeded failure: implementation returns 900, while this stale expectation says 800.
if (discounted(1000, 10) !== 800) throw new Error("discounted expectation mismatch");