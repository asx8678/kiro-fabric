// Checkout shim only. Agent staging copies the reviewed canonical implementation
// into this same package-local path so no checkout/src dependency survives.
export * from "../src/installation/filesystem-boundary.mjs";
