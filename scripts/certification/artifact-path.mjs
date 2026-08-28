import fs from "node:fs";
import path from "node:path";

const physicalPath = (value) => {
  let cursor = path.resolve(value);
  const missing = [];
  while (!fs.existsSync(cursor)) {
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    missing.unshift(path.basename(cursor));
    cursor = parent;
  }
  return path.resolve(fs.realpathSync.native(cursor), ...missing);
};

/** Test containment after resolving existing symlinked ancestors. */
export const pathIsInside = (parent, candidate) => {
  const relative = path.relative(physicalPath(parent), physicalPath(candidate));
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`));
};

export const assertArtifactOutsideCheckout = (root, candidate, label) => {
  if (candidate && pathIsInside(root, candidate)) {
    throw new Error(`${label} must point outside the checkout so the artifact cannot invalidate its own Git binding`);
  }
};
