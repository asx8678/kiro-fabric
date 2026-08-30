// Installed management surface. The immutable release executes this module with
// its attested Node and supports detached status, doctor, launch, repair/update,
// and uninstall without importing the npm/source bootstrap origin.

import { runKiroSetup } from "./setup.js";

export const runInstalledManagement = (argv: string[]): Promise<number> =>
  runKiroSetup(argv);
