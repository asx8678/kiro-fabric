import { runKiroDoctor as runKiroDoctorProduction, type KiroDoctorOptions, type KiroDoctorReport } from "./doctor.js";
import { withPrivateKiroLauncherFixtures } from "./compatibility-test-seam.js";

/** Test-only shebang-fixture seam; intentionally outside package exports. */
export const runKiroDoctor = async (options: KiroDoctorOptions = {}): Promise<KiroDoctorReport> =>
  options.kiroBinary
    ? withPrivateKiroLauncherFixtures([options.kiroBinary], () => runKiroDoctorProduction(options))
    : runKiroDoctorProduction(options);
