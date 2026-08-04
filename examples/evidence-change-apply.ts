const target = "README.md";
const explicitlyRequested = true;
const explicitlyAllowlistedPath = "README.md";
const exactPatch = { old: "exact old text", new: "exact replacement" };
const explicitlyConfiguredProbe = "";
if (!explicitlyRequested || explicitlyAllowlistedPath !== target)
  return {
    status: "proposal",
    exactPatch,
    reason: "Apply was not both explicitly requested and allowlisted.",
  };
const before = await fabric.fs.read({ path: target, maxChars: 100000 });
if (before.truncated)
  return {
    status: "failed",
    reason: "Complete preimage was not read; no patch applied.",
    evidence: before,
  };
const applied = await fabric.fs.patch({ path: target, patch: JSON.stringify(exactPatch) });
const after = await fabric.fs.read({ path: target, maxChars: 100000 });
if (after.truncated)
  return {
    status: "partial",
    reason: "Patch applied but complete readback was unavailable.",
    applied,
    evidence: { before, after },
  };
const probe =
  explicitlyConfiguredProbe === ""
    ? undefined
    : await fabric.shell.run({ command: explicitlyConfiguredProbe });
return {
  status:
    after.content === before.content.replace(exactPatch.old, exactPatch.new)
      ? "succeeded"
      : "failed",
  applied,
  evidence: { before, after },
  probe,
  claimsExcluded: ["rollback", "transaction", "certification"],
};
