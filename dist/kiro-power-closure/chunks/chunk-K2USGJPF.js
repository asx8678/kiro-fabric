import { createRequire as __createRequire } from "node:module";
import { fileURLToPath as __fileURLToPath } from "node:url";
import { dirname as __dirnameOf } from "node:path";
globalThis.__filename = __fileURLToPath(import.meta.url);
globalThis.__dirname = __dirnameOf(globalThis.__filename);
const require = __createRequire(import.meta.url);


// node_modules/.pnpm/mcporter@0.13.8/node_modules/mcporter/dist/daemon/launch.js
import { spawn } from "node:child_process";
import path from "node:path";
function launchDaemonDetached(options, launch = spawn) {
  const invocation = buildDaemonLaunchInvocation(options);
  const child = launch(invocation.command, invocation.args, {
    detached: true,
    stdio: "ignore",
    env: invocation.env
  });
  child.unref();
}
function buildDaemonLaunchInvocation(options, processInfo = {
  argvEntry: process.argv[1],
  env: process.env,
  execArgv: process.execArgv,
  execPath: process.execPath,
  platform: process.platform
}) {
  const cliEntry = resolveCliEntry(processInfo.argvEntry);
  const configArgs = options.configExplicit ? ["--config", options.configPath] : [];
  const args = [
    ...processInfo.execArgv,
    ...cliEntry ? [cliEntry] : [],
    ...configArgs,
    ...options.rootDir ? ["--root", options.rootDir] : [],
    "daemon",
    "start",
    "--foreground",
    ...options.extraArgs ?? []
  ];
  const env = {
    ...processInfo.env,
    MCPORTER_DAEMON_CHILD: "1",
    MCPORTER_DAEMON_SOCKET: options.socketPath,
    MCPORTER_DAEMON_METADATA: options.metadataPath
  };
  if (shouldWrapDetachedLaunchWithNohup(processInfo.platform, cliEntry)) {
    return {
      command: "nohup",
      args: [processInfo.execPath, ...args],
      env
    };
  }
  return {
    command: processInfo.execPath,
    args,
    env
  };
}
function shouldWrapDetachedLaunchWithNohup(platform, cliEntry) {
  return platform === "darwin" && cliEntry === void 0;
}
function resolveCliEntry(entry = process.argv[1]) {
  if (!entry) {
    throw new Error("Unable to resolve mcporter entry script.");
  }
  if (entry.startsWith("/$bunfs/")) {
    return void 0;
  }
  return path.resolve(entry);
}

export {
  launchDaemonDetached,
  buildDaemonLaunchInvocation
};
