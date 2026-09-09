import os from "node:os";
import { execFileSync } from "node:child_process";

export const normalizeArchitecture = (arch) => ({ aarch64: "arm64", x86_64: "x64", arm64: "arm64", x64: "x64" })[arch];
export const compareVersions = (a, b) => {
  const left = String(a).split(/[.-]/u).slice(0, 3).map(Number), right = String(b).split(/[.-]/u).slice(0, 3).map(Number);
  if (left.some(n => !Number.isSafeInteger(n)) || right.some(n => !Number.isSafeInteger(n))) throw new Error("Unsupported system version");
  for (let i = 0; i < 3; i++) { if ((left[i] ?? 0) !== (right[i] ?? 0)) return (left[i] ?? 0) > (right[i] ?? 0) ? 1 : -1; }
  return 0;
};
const systemValue = (command, args) => execFileSync(command, args, { env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", LANG: "C" }, encoding: "utf8", timeout: 3000, maxBuffer: 4096 }).trim();
/** Injectable observations are internal test inputs, never environment overrides. */
export function detectInstallerPlatform(observation = {}) {
  const platform = observation.platform ?? process.platform;
  const arch = normalizeArchitecture(observation.arch ?? process.arch);
  if (!["linux", "darwin"].includes(platform) || !arch) throw Object.assign(new Error("Unsupported platform; expected macOS/Linux x64 or arm64"), { code: "PREREQUISITE" });
  let selectedArch = arch, rosetta = false, osVersion, libcVersion = null;
  if (platform === "linux") {
    const header = observation.glibc === undefined && observation.platform === undefined ? /** @type {{header?:{glibcVersionRuntime?:string}}} */ (process.report.getReport()).header : undefined;
    libcVersion = observation.glibc ?? header?.glibcVersionRuntime;
    osVersion = observation.osVersion ?? os.release();
    if (!libcVersion) throw Object.assign(new Error("Unsupported Linux libc: this bundle requires glibc; musl is not qualified"), { code: "PREREQUISITE" });
    // Linux LOCALVERSION suffixes are not semver (e.g. Raspberry Pi's +rpt).
    // Keep the general Node/Kiro/libc version comparator unchanged.
    const kernel = /^(\d+\.\d+(?:\.\d+)?)(?:\.\d+)*(?:[-+][A-Za-z0-9._+-]*)?$/u.exec(String(osVersion));
    if (!kernel) throw Object.assign(new Error("Unsupported Linux kernel version"), { code: "PREREQUISITE" });
    if (compareVersions(libcVersion, "2.28") < 0 || compareVersions(kernel[1], "4.18") < 0) throw Object.assign(new Error("Linux requires glibc >=2.28 and kernel >=4.18"), { code: "PREREQUISITE" });
  } else {
    rosetta = observation.rosetta ?? (arch === "x64" && (() => { try { return systemValue("/usr/sbin/sysctl", ["-in", "sysctl.proc_translated"]) === "1"; } catch { return false; } })());
    if (rosetta) selectedArch = "arm64";
    osVersion = observation.osVersion ?? systemValue("/usr/bin/sw_vers", ["-productVersion"]);
    if (compareVersions(osVersion, "13.5") < 0) throw Object.assign(new Error("macOS >=13.5 is required by the pinned Node runtime"), { code: "PREREQUISITE" });
  }
  return { target: `${platform}-${selectedArch}`, platform, arch: selectedArch, processArch: arch, rosetta, libc: platform === "linux" ? "glibc" : "system", libcVersion, osVersion };
}
export function assertUnprivilegedInstaller(env = process.env) {
  if ((typeof process.getuid === "function" && process.getuid() === 0) || env.SUDO_USER || env.SUDO_UID || env.SUDO_GID) throw Object.assign(new Error("Do not run the Fabric installer with sudo or as root"), { code: "PREREQUISITE" });
}
export const compatibilityFor = (target) => ({ minNode: "24.20.0", minKiro: "2.21.1", minGlibc: target.startsWith("linux-") ? "2.28" : null, minKernel: target.startsWith("linux-") ? "4.18" : null, minMacOS: target.startsWith("darwin-") ? "13.5" : null, libc: target.startsWith("linux-") ? "glibc" : "system" });
