const target = "README.md";
const before = await fabric.fs.read({ path: target, maxChars: 12000 });
return {
  status: "proposal",
  reason: "Writes are default denied; no explicit allowlisted write was requested.",
  evidence: { path: before.path, preimage: before.content },
  proposedPatch: { old: "exact old text", new: "exact replacement" },
  claimsExcluded: ["transaction", "certification", "rollback"],
};
