#!/usr/bin/env node
// Self-hosted lifecycle entry shipped inside each immutable installed release.
// It intentionally delegates to the same setup implementation as bootstrap;
// when launched with the release's attested Node, repair/update resolves the
// current release itself as the artifact source.

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

const invokedPath = process.argv[1] ? realpathSync(process.argv[1]) : "";
const selfPath = fileURLToPath(import.meta.url);
if (invokedPath === selfPath || invokedPath === realpathSync(selfPath)) {
  const { runInstalledManagement } = await import("./management.js");
  process.exitCode = await runInstalledManagement(process.argv.slice(2));
}
