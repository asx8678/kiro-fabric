import childProcess from "node:child_process";
import fs from "node:fs";
import type { OwnedFile } from "./owned-file.js";
import { pinnedDirectoryIdentity, pinnedEntryIdentity, runPinnedDirectoryOperation, type EntryIdentity, type ParentOptions } from "../installation/pinned-directory-child.mjs";

const sameIdentity = (left: object, right: object): boolean => JSON.stringify(left) === JSON.stringify(right);
const entryName = (name: string): void => {
  if (!name || name === "." || name === ".." || /[/\\\x00-\x1f\x7f]/u.test(name)) throw new Error("invalid pinned state entry name");
};

export function pinnedStatePath(options: ParentOptions, name: string): string | undefined {
  entryName(name);
  options.check();
  const held = fs.fstatSync(options.fd, { bigint: true });
  if (!held.isDirectory() || !sameIdentity(options.parent, pinnedDirectoryIdentity(held))) throw new Error("state directory descriptor identity mismatch");
  if (process.platform !== "linux") return undefined;
  const directory = `/proc/self/fd/${options.fd}`;
  const pinned = fs.statSync(`${directory}/.`, { bigint: true });
  if (!pinned.isDirectory() || !sameIdentity(options.parent, pinnedDirectoryIdentity(pinned))) throw new Error("unsafe state directory descriptor traversal");
  return `${directory}/${name}`;
}

export function initializePinnedStateFile(options: ParentOptions, name: string, owned: OwnedFile, initialize: (fd: number) => void, close: (fd: number) => void = fs.closeSync): void {
  const pinned = pinnedStatePath(options, name);
  if (pinned === undefined) {
    if (process.platform === "win32") throw new Error("descriptor-anchored state creation is unavailable");
    try {
      const created = runPinnedDirectoryOperation({ ...options, operation: "writeExclusive", name });
      owned.created = true;
      if (!created) throw new Error("state file ownership identity unavailable");
      owned.identity = { dev: Number(created.dev), ino: Number(created.ino) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") owned.created = true;
      throw error;
    }
  }
  const descriptor = fs.openSync(pinned ?? `${options.cwd}/${name}`, fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK |
    (pinned === undefined ? 0 : fs.constants.O_CREAT | fs.constants.O_EXCL), 0o600);
  owned.created = true;
  const errors: unknown[] = [];
  let closeUncertain = false;
  try {
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile() || stat.nlink !== 1 || (owned.identity && (stat.dev !== owned.identity.dev || stat.ino !== owned.identity.ino)) ||
        (stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.()) throw new Error("state file ownership changed before initialization");
    owned.identity = { dev: stat.dev, ino: stat.ino };
    options.check();
    initialize(descriptor);
  } catch (error) { errors.push(error); }
  finally {
    if (!owned.identity) {
      try {
        const stat = fs.fstatSync(descriptor);
        owned.identity = { dev: stat.dev, ino: stat.ino };
      } catch (error) { errors.push(error); }
    }
    try { close(descriptor); } catch (error) { closeUncertain = true; errors.push(error); }
  }
  if (errors.length) throw new AggregateError(errors, closeUncertain
    ? "owned file initialization failed; descriptor close uncertain (never retried)"
    : owned.identity ? "owned file initialization failed"
    : "uncertain lock/file: ownership identity unavailable; operator recovery required", { cause: errors[0] });
}

const publicationSource = `
const fs = require('node:fs');
let published = false;
try {
  const input = Buffer.alloc(32769); let size = 0;
  while (size < input.length) {
    const count = fs.readSync(0, input, size, input.length - size, null);
    if (!count) break;
    size += count;
  }
  if (size > 32768) throw Error('State publication input bound');
  const request = JSON.parse(input.subarray(0, size).toString('utf8'));
  const identity = stat => ({ dev: String(stat.dev), ino: String(stat.ino), mode: Number(stat.mode), uid: Number(stat.uid), gid: Number(stat.gid) });
  const entry = stat => ({ ...identity(stat), nlink: String(stat.nlink), size: String(stat.size), mtimeNs: String(stat.mtimeNs), ctimeNs: String(stat.ctimeNs) });
  const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);
  const name = value => typeof value === 'string' && value && value !== '.' && value !== '..' && !/[\\/\\\\\\x00-\\x1f\\x7f]/u.test(value);
  if (!name(request.name) || !name(request.target) || request.name === request.target) throw Error('Invalid state publication names');
  const parent = () => {
    const held = fs.fstatSync(3, { bigint: true }), cwd = fs.statSync('.', { bigint: true });
    if (!held.isDirectory() || !cwd.isDirectory() || !equal(identity(held), request.parent) || !equal(identity(cwd), request.parent)) throw Error('State publication directory changed');
  };
  const captured = (name, expected) => {
    const stat = fs.lstatSync(name, { bigint: true });
    if (!stat.isFile() || stat.nlink !== 1n || stat.uid !== BigInt(process.getuid()) || (stat.mode & 0o077n) !== 0n || !equal(entry(stat), expected)) throw Error('State publication entry changed; replacement preserved');
  };
  parent(); captured(request.name, request.expected);
  if (request.targetExpected) captured(request.target, request.targetExpected);
  else {
    try { fs.lstatSync(request.target); throw Error('State publication destination appeared; replacement preserved'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  parent();
  fs.renameSync(request.name, request.target);
  published = true;
  process.stdout.write(JSON.stringify({ published }));
} catch (error) {
  process.stdout.write(JSON.stringify({ published, error: String(error.message).slice(0, 400) }));
}
`;

export function publishPinnedStateFile(options: ParentOptions, name: string, target: string, expected: EntryIdentity, targetExpected: EntryIdentity | undefined, published: () => void): void {
  const source = pinnedStatePath(options, name);
  entryName(target);
  if (source !== undefined) {
    const destination = pinnedStatePath(options, target)!;
    const captured = (file: string, identity: EntryIdentity): void => {
      const current = fs.lstatSync(file, { bigint: true });
      if (!current.isFile() || current.nlink !== 1n || current.uid !== BigInt(process.getuid!()) ||
          (current.mode & 0o077n) !== 0n || !sameIdentity(pinnedEntryIdentity(current), identity)) {
        throw new Error("state publication entry changed; replacement preserved");
      }
    };
    captured(source, expected);
    if (targetExpected) captured(destination, targetExpected);
    else {
      try { fs.lstatSync(destination); throw new Error("state publication destination appeared; replacement preserved"); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
    options.check();
    fs.renameSync(source, destination);
    published();
  } else {
    if (process.platform === "win32") throw new Error("descriptor-anchored state publication is unavailable");
    const child = childProcess.spawnSync(process.execPath, ["--input-type=commonjs", "-e", publicationSource], {
      cwd: options.cwd, timeout: 30_000, killSignal: "SIGKILL", env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" },
      stdio: ["pipe", "pipe", "pipe", options.fd], encoding: "utf8", maxBuffer: 4096,
      input: JSON.stringify({ parent: options.parent, name, target, expected, targetExpected }),
    });
    let result: { published?: boolean; error?: string } | undefined;
    try { result = JSON.parse(child.stdout) as typeof result; } catch {}
    if (result?.published === true) published();
    if (child.error || child.status !== 0 || child.signal || result?.published !== true || result.error !== undefined) {
      throw new Error(`state publication acknowledgement failed; preserve evidence: ${result?.error ?? "child unavailable"}`);
    }
  }
  options.check();
}
