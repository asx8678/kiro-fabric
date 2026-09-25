import fs from "node:fs";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { runPinnedRecovery } from "./pinned-recovery.mjs";

// Cooperating-process crash recovery, NOT an OS sandbox against hostile same-user
// mutation. The caller validates home ancestry and reconciles its transaction
// journal under this lock before any installation/data mutation. No path supplied
// in an owner/claim record is ever followed. Quarantines are deliberately retained.
/** @typedef {{dev: string, ino: string}} FileIdentity */
/** @typedef {{platform: string, pid: number, boot: string, start: string, namespace: string}} ProcessIncarnation */
/** @typedef {{schema: number, kind: string, root: FileIdentity, lock: FileIdentity, nonce: string, process: ProcessIncarnation, transactionId: string | null, file?: FileIdentity, lockBirth?: string, recovered?: InstallationLockRecovery[]}} InstallationLockOwner */
/** @typedef {{quarantine: string, owner: InstallationLockOwner, release?: {file: FileIdentity, hash: string}}} InstallationLockRecovery */
/** @typedef {((options?: {retainLegacyGate?: boolean}) => unknown) & {recovered: InstallationLockRecovery[], owner: InstallationLockOwner}} InstallationLockRelease */
/** @typedef {InstallationLockRelease & {retainedLegacyGate?: boolean, releasedLegacyGate?: boolean, legacyGate?: string, retainLegacyGate?: () => void}} InstallationExclusionRelease */
/** @typedef {{status: 'absent' | 'busy' | 'stale' | 'recovery-required' | 'unsupported', available: boolean, owner?: InstallationLockOwner, claims?: number, recoverable?: boolean, reason?: string, legacyGate?: {path: string, owner?: {pid: number, nonce: string}}}} InstallationLockInspection */

const LOCK = ".install-lock";
const RELEASE = ".install-lock-release.json";
const MAX_CONTROL = 4096;
const MAX_CLAIMS = 16;
const NONCE = /^[a-f0-9]{64}$/u;
const DECIMAL = /^(0|[1-9][0-9]{0,24})$/u;
const TRANSACTION = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;
const hash = (text) => createHash("sha256").update(text).digest("hex");
const nonce = () => randomBytes(32).toString("hex");
const identity = (stat) => ({ dev: String(stat.dev), ino: String(stat.ino) });
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const same = (a, b) => a?.dev === b?.dev && a?.ino === b?.ino;
const errorCode = (error) => error?.code;
/** @param {string} message @param {string} [code] @returns {never} */
const fail = (message, code = "INSTALL_LOCK_RECOVERY_REQUIRED") => {
  throw Object.assign(new Error(message), { code });
};
const keys = (value, names) => value && typeof value === "object" && !Array.isArray(value)
  && equal(Object.keys(value).sort(), [...names].sort());
const validIdentity = (value) => keys(value, ["dev", "ino"])
  && typeof value.dev === "string" && DECIMAL.test(value.dev)
  && typeof value.ino === "string" && DECIMAL.test(value.ino);
const validProcess = (value) => keys(value, ["platform", "pid", "boot", "start", "namespace"])
  && ["linux", "darwin"].includes(value.platform) && Number.isSafeInteger(value.pid) && value.pid > 0 && value.pid <= 2147483647
  && typeof value.boot === "string" && (value.platform === "linux" ? /^[a-f0-9-]{36}$/u.test(value.boot) : /^[0-9]{1,12}:[0-9]{1,6}$/u.test(value.boot))
  && typeof value.start === "string" && (value.platform === "linux" ? DECIMAL.test(value.start) : /^[A-Z][a-z]{2} [A-Z][a-z]{2} [ 0-9][0-9] [0-9]{2}:[0-9]{2}:[0-9]{2} [0-9]{4}$/u.test(value.start))
  && typeof value.namespace === "string" && (value.platform === "linux" ? /^pid:\[[0-9]+\]$/u.test(value.namespace) : value.namespace === "host");

// These kernel files report size=0; read at most limit+1 bytes, never readFile on
// an untrusted process/control stream. All descriptors close even on faults.
const boundedText = (target, limit) => {
  const fd = fs.openSync(target, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const buffer = Buffer.alloc(limit + 1);
    let count = 0;
    while (count <= limit) {
      const got = fs.readSync(fd, buffer, count, buffer.length - count, null);
      if (!got) break;
      count += got;
    }
    if (count > limit) fail("process observation exceeds bound");
    return buffer.subarray(0, count).toString("utf8");
  } finally { fs.closeSync(fd); }
};
const systemCommand = (file, args, allowAbsent = false) => {
  try {
    return execFileSync(file, args, {
      encoding: "utf8", timeout: 1000, killSignal: "SIGKILL", maxBuffer: MAX_CONTROL,
      env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", LC_ALL: "C", LANG: "C", TZ: "UTC" },
      stdio: ["ignore", "pipe", "pipe"],
    }).trimEnd();
  } catch (error) {
    if (allowAbsent && error.status === 1 && !error.stdout && !error.stderr) return "";
    fail("bounded system process inspection unavailable", "INSTALL_LOCK_UNSUPPORTED");
  }
};
const bootIdentity = () => {
  if (process.platform === "linux") {
    const boot = boundedText("/proc/sys/kernel/random/boot_id", 64).trim();
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(boot)) fail("invalid kernel boot identity");
    return boot;
  }
  if (process.platform === "darwin") {
    const value = systemCommand("/usr/sbin/sysctl", ["-n", "kern.boottime"]);
    const match = /^\{ sec = ([0-9]{1,12}), usec = ([0-9]{1,6}) \}/u.exec(value);
    if (!match) fail("ambiguous kernel boot identity", "INSTALL_LOCK_UNSUPPORTED");
    return `${match[1]}:${match[2]}`;
  }
  fail("installation locks require Linux or macOS", "INSTALL_LOCK_UNSUPPORTED");
};
const processSample = (pid) => {
  if (process.platform === "linux") {
    let text;
    try { text = boundedText(`/proc/${pid}/stat`, MAX_CONTROL); }
    catch (error) { if (errorCode(error) === "ENOENT" || errorCode(error) === "ESRCH") return null; throw error; }
    // comm can contain spaces, parentheses and newlines; field 22 follows its LAST ')'.
    const end = text.lastIndexOf(") ");
    if (!text.startsWith(`${pid} (`) || end < 0) fail("ambiguous proc stat identity");
    const fields = text.slice(end + 2).trim().split(/\s+/u);
    if (fields.length < 20 || !DECIMAL.test(fields[19])) fail("invalid proc start ticks");
    return { start: fields[19], zombie: ["Z", "X", "x"].includes(fields[0]) };
  }
  const text = systemCommand("/bin/ps", ["-p", String(pid), "-o", "pid=", "-o", "lstart=", "-o", "stat="], true);
  if (!text) return null;
  const match = /^\s*([0-9]+)\s+([A-Z][a-z]{2} [A-Z][a-z]{2} [ 0-9][0-9] [0-9]{2}:[0-9]{2}:[0-9]{2} [0-9]{4})\s+([A-Za-z+< >NsETWX-]+)$/u.exec(text);
  if (!match || Number(match[1]) !== pid) fail("ambiguous ps process identity");
  return { start: match[2], zombie: match[3].startsWith("Z") };
};
const liveness = (pid) => {
  try { process.kill(pid, 0); return "present"; }
  catch (error) { return errorCode(error) === "ESRCH" ? "absent" : "uncertain"; }
};
const namespaceIdentity = () => process.platform === "linux" ? fs.readlinkSync("/proc/self/ns/pid") : "host";
const currentProcess = () => {
  const boot = bootIdentity();
  const first = processSample(process.pid);
  const namespace = namespaceIdentity();
  const second = processSample(process.pid);
  if (!first || !equal(first, second) || first.zombie || boot !== bootIdentity() || liveness(process.pid) !== "present") fail("own process incarnation unavailable", "INSTALL_LOCK_UNSUPPORTED");
  const value = { platform: process.platform, pid: process.pid, boot, start: first.start, namespace };
  if (!validProcess(value)) fail("invalid own process incarnation", "INSTALL_LOCK_UNSUPPORTED");
  return value;
};
const incarnationState = (owner) => {
  try {
    if (!validProcess(owner) || owner.platform !== process.platform) return "uncertain";
    const own = currentProcess(); // Ensures kernel visibility, not a PID/age-only guess.
    // Linux boot_id is a kernel incarnation UUID. A macOS wall-clock boot
    // timestamp is not given that stronger identity guarantee: changes without
    // native qualification remain uncertain, never stale-deletion authority.
    if (own.boot !== owner.boot) return process.platform === "linux" ? "dead" : "uncertain";
    if (own.namespace !== owner.namespace) return "uncertain";
    const first = processSample(owner.pid);
    const firstLive = liveness(owner.pid);
    const second = processSample(owner.pid);
    const secondLive = liveness(owner.pid);
    if (bootIdentity() !== own.boot || !equal(first, second) || firstLive !== secondLive || firstLive === "uncertain") return "uncertain";
    if (!first) return firstLive === "absent" ? "dead" : "uncertain";
    if (firstLive !== "present") return "uncertain";
    if (first.start !== owner.start || first.zombie) return "dead";
    // macOS lstart has second precision. Equal evidence is ALWAYS treated as
    // live/uncertain, including possible same-second PID reuse; never age it out.
    return "live";
  } catch { return "uncertain"; }
};

const privateStat = (target, directory, links = 1) => {
  const stat = fs.lstatSync(target, { bigint: true });
  if ((directory ? !stat.isDirectory() : !stat.isFile()) || stat.isSymbolicLink()
    || typeof process.getuid !== "function" || stat.uid !== BigInt(process.getuid())
    || (stat.mode & 0o7777n) !== (directory ? 0o700n : 0o600n)
    || (!directory && (stat.nlink !== BigInt(links) || stat.size > BigInt(MAX_CONTROL)))) fail("unsafe installation lock identity, type, size or mode");
  return stat;
};
const rootIdentity = (base) => {
  if (typeof base !== "string" || !path.isAbsolute(base) || base === path.parse(base).root
    || /[\x00-\x1f\x7f]/u.test(base) || path.resolve(base) !== base || fs.realpathSync(base) !== base) fail("installation lock base must be an existing canonical private directory");
  return identity(privateStat(base, true));
};
const assertRoot = (base, root) => { if (!same(rootIdentity(base), root)) fail("installation root replaced"); };
const entries = (target) => {
  const dir = fs.opendirSync(target);
  const result = [];
  try {
    let entry;
    while ((entry = dir.readSync())) {
      result.push(entry.name);
      if (result.length > MAX_CLAIMS + 1) fail("installation lock entry bound exceeded");
    }
  } finally { dir.closeSync(); }
  return result.sort();
};
const control = (target, links = 1) => {
  const before = privateStat(target, false, links);
  const fd = fs.openSync(target, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    if (!same(identity(before), identity(fs.fstatSync(fd, { bigint: true })))) fail("lock control replaced before read");
    const buffer = Buffer.alloc(MAX_CONTROL + 1);
    let count = 0;
    while (count <= MAX_CONTROL) {
      const got = fs.readSync(fd, buffer, count, buffer.length - count, null);
      if (!got) break;
      count += got;
    }
    if (count > MAX_CONTROL || BigInt(count) !== before.size) fail("invalid lock control size");
    const text = buffer.subarray(0, count).toString("utf8");
    const after = privateStat(target, false, links);
    if (!same(identity(before), identity(after)) || before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs) fail("lock control changed during read");
    const value = JSON.parse(text);
    if (text !== `${JSON.stringify(value)}\n`) fail("noncanonical lock control");
    return { value, file: identity(after), hash: hash(text) };
  } finally { fs.closeSync(fd); }
};
const binding = (record) => ({ file: record.file, hash: record.hash });
const claimName = (index) => `claim-${String(index).padStart(2, "0")}.json`;
const quarantineName = (owner) => `.install-lock-quarantine-${owner.nonce}`;
const plainOwner = ({ recovered: _recovered, ...owner }) => owner;
const validPlainOwner = (value, root) => keys(value, ["schema", "kind", "root", "lock", "nonce", "process", "transactionId", ...(value?.file === undefined ? [] : ["file"]), ...(value?.lockBirth === undefined ? [] : ["lockBirth"])])
  && (value.file === undefined || validIdentity(value.file)) && (value.lockBirth === undefined || (typeof value.lockBirth === "string" && DECIMAL.test(value.lockBirth) && value.lockBirth !== "0"))
  && value.schema === 1 && value.kind === "kiro-fabric-install-lock" && validIdentity(value.root) && same(value.root, root)
  && validIdentity(value.lock) && typeof value.nonce === "string" && NONCE.test(value.nonce) && validProcess(value.process)
  && (value.transactionId === null || (typeof value.transactionId === "string" && TRANSACTION.test(value.transactionId)));
const validBinding = (value) => keys(value, ["file", "hash"]) && validIdentity(value.file) && typeof value.hash === "string" && NONCE.test(value.hash);
// Flattened, bounded provenance survives death of the replacement owner. In
// particular, a committed rollback with an already-cleaned journal must not be
// toggled by another retry. No recorded path is used as filesystem authority.
const validOwner = (value, root, lock = value?.lock) => value && validPlainOwner(plainOwner(value), root) && same(value.lock, lock)
  && (value.recovered === undefined || (Array.isArray(value.recovered) && value.recovered.length > 0 && value.recovered.length <= MAX_CLAIMS
    && value.recovered.every(r => keys(r, r?.release === undefined ? ["quarantine", "owner"] : ["quarantine", "owner", "release"])
      && validPlainOwner(r.owner, root) && r.quarantine === quarantineName(r.owner) && (r.release === undefined || validBinding(r.release)))));
const remember = (recovered, owner, release) => {
  for (const record of [...(owner.recovered ?? []), { quarantine: quarantineName(owner), owner: plainOwner(owner), ...(release ? { release } : {}) }]) {
    const previous = recovered.find(r => r.owner.nonce === record.owner.nonce);
    if (previous && !equal(previous, record)) fail("conflicting lock recovery provenance");
    if (!previous) recovered.push(record);
  }
};
const snapshot = (base, root, name = LOCK) => {
  assertRoot(base, root);
  const target = path.join(base, name);
  const lockStat = privateStat(target, true), lock = identity(lockStat);
  const names = entries(target);
  if (!names.includes("owner.json")) fail("uninitialized installation lock; preserve for recovery");
  const ownerPath = path.join(target, "owner.json");
  const linkedRelease = fs.lstatSync(ownerPath, { bigint: true }).nlink === 2n;
  const owner = control(ownerPath, linkedRelease ? 2 : 1);
  const value = owner.value;
  if (linkedRelease && (!same(value.file, owner.file) || value.lockBirth === undefined || !equal(control(path.join(base, RELEASE), 2), owner))) fail("unproven linked release owner");
  if (!validOwner(value, root, lock) || (value.file !== undefined && !same(value.file, owner.file)) || (value.lockBirth !== undefined && value.lockBirth !== String(lockStat.birthtimeNs))) fail("invalid installation lock owner binding");
  const claims = [];
  let previous = binding(owner);
  for (let index = 0; index < names.length - 1; index++) {
    const name = claimName(index);
    if (!names.includes(name) || index >= MAX_CLAIMS) fail("foreign or noncontiguous lock claims");
    const claim = control(path.join(target, name));
    const c = claim.value;
    if (!keys(c, ["schema", "kind", "nonce", "process", "owner", "previous", "index", "quarantine"])
      || c.schema !== 1 || c.kind !== "kiro-fabric-lock-recovery" || !NONCE.test(c.nonce) || !validProcess(c.process)
      || !equal(c.owner, binding(owner)) || !equal(c.previous, previous) || c.index !== index || c.quarantine !== quarantineName(value)) fail("invalid recovery claim binding");
    claims.push(claim);
    previous = binding(claim);
  }
  const finalLock = privateStat(target, true);
  if (!same(identity(finalLock), lock) || (value.lockBirth !== undefined && String(finalLock.birthtimeNs) !== value.lockBirth) || !equal(entries(target), names)) fail("installation lock changed during inspection");
  assertRoot(base, root);
  return { root, lock, owner, claims, ...(linkedRelease ? { linkedRelease: true } : {}) };
};
// The marker is an O_EXCL hard link of the exact owner, never a newly written
// JSON partial. Two links are accepted ONLY when both fixed names are proven.
// An arbitrary empty .install-lock still has no recovery authority.
const pendingRelease = (base, root) => {
  assertRoot(base, root);
  const markerPath = path.join(base, RELEASE);
  let stat;
  try { stat = fs.lstatSync(markerPath, { bigint: true }); }
  catch (error) { if (errorCode(error) === "ENOENT") return null; throw error; }
  if (![1n, 2n].includes(stat.nlink)) fail("invalid release marker links");
  const links = Number(stat.nlink), owner = control(markerPath, links);
  if (!validOwner(owner.value, root) || !same(owner.value.file, owner.file) || owner.value.lockBirth === undefined) fail("invalid release marker owner binding");
  const target = path.join(base, LOCK);
  let lock, birth;
  try { const s = privateStat(target, true); lock = identity(s); birth = String(s.birthtimeNs); }
  catch (error) { if (errorCode(error) !== "ENOENT") throw error; }
  let directory = same(lock, owner.value.lock) && birth === owner.value.lockBirth;
  let hasOwner = false, current, claims = [];
  if (lock) {
    // A freshly created directory can reuse the removed inode. Its durable,
    // self-bound owner must explicitly carry this exact marker's provenance.
    try {
      const candidate = snapshot(base, root);
      if (candidate.owner.value.recovered?.some(r => equal(r.release, binding(owner)) && equal(r.owner, plainOwner(owner.value)))) { current = candidate; directory = false; }
    } catch { /* The original releasing directory is validated below. */ }
  }
  if (directory) {
    const names = entries(target);
    hasOwner = names.includes("owner.json");
    if ((!hasOwner && names.length) || links !== (hasOwner ? 2 : 1)) fail("release directory or owner changed");
    if (hasOwner) {
      const state = snapshot(base, root);
      if (!equal(state.owner, owner)) fail("release directory or owner changed");
      claims = state.claims;
    }
    const finalLock = privateStat(target, true);
    if (!same(identity(finalLock), lock) || String(finalLock.birthtimeNs) !== owner.value.lockBirth) fail("release directory replaced");
  } else {
    if (lock && !current) fail("release marker belongs to another lock inode");
    if (links === 2) {
      const name = quarantineName(owner.value), archived = fs.lstatSync(path.join(base, name));
      const record = archived.isDirectory() ? snapshot(base, root, name).owner : control(path.join(base, name), 2);
      if (!equal(record, owner)) fail("release archive replaced");
    }
  }
  assertRoot(base, root);
  if (!equal(control(markerPath, links), owner)) fail("release marker changed");
  return { root, lock: owner.value.lock, owner, claims, releasing: true, directory, hasOwner, current, links };
};
const assertSnapshot = (base, expected) => {
  if (!equal(snapshot(base, expected.root), expected)) fail("installation lock ownership changed");
};
// Pin the original directory BEFORE opening a recovery claim. A lagging
// contender must not write into a freshly acquired replacement .install-lock
// after another contender quarantines the stale one. Node has no openat API;
// Linux uses a kernel FD directory path. macOS uses a separate child with a
// kernel-pinned cwd and inode-checked relative operations (never parent chdir).
const inOwnedDirectory = (target, expected, action) => {
  const fd = fs.openSync(target, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
  try {
    const pinned = fs.fstatSync(fd, { bigint: true });
    if (!same(identity(pinned), expected.lock) || (expected.owner.value.lockBirth !== undefined && String(pinned.birthtimeNs) !== expected.owner.value.lockBirth)) fail("recovery directory replaced before claim");
    const anchored = `${process.platform === "linux" ? "/proc/self/fd" : "/dev/fd"}/${fd}`;
    try {
      const name = expected.releasing ? `../${RELEASE}` : "owner.json";
      if (!same(identity(fs.statSync(anchored, { bigint: true })), expected.lock)
        || !same(identity(privateStat(`${anchored}/${name}`, false, (expected.linkedRelease || (expected.releasing && expected.hasOwner)) ? 2 : 1)), expected.owner.file)) fail("recovery directory capability changed");
    } catch { fail("kernel directory-FD traversal unavailable; preserve lock", "INSTALL_LOCK_UNSUPPORTED"); }
    return action(anchored);
  } finally { fs.closeSync(fd); }
};
const syncDirectory = (target) => {
  const fd = fs.openSync(target, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
};

const assertPending = (base, expected) => {
  if (!equal(pendingRelease(base, expected.root), expected)) fail("installation release ownership changed");
};
const pinnedReleaseOperation = (base, expected, operation) => {
  const target = path.join(base, LOCK);
  if (process.platform === "darwin") {
    if (operation === "restore") return runPinnedRecovery(target, expected, { operation });
    // Never delegate release deletion or marker creation to a child that can
    // outlive a SIGKILLed owner and race its reclaimer. The child only inspects;
    // the parent repeats the namespace proof before its fixed-path syscall,
    // retaining the original cooperating-process (not hostile same-user) model.
    runPinnedRecovery(target, expected);
    if (expected.releasing) assertPending(base, expected); else assertSnapshot(base, expected);
    if (operation === "release") fs.linkSync(path.join(target, "owner.json"), path.join(base, RELEASE));
    else if (operation === "remove-owner") fs.unlinkSync(path.join(target, "owner.json"));
    else if (operation !== "inspect") fail("invalid pinned release operation");
    return;
  }
  return inOwnedDirectory(target, expected, anchored => {
    if (expected.releasing) assertPending(base, expected); else assertSnapshot(base, expected);
    const owner = path.join(anchored, "owner.json"), marker = `${anchored}/../${RELEASE}`;
    if (operation === "release") fs.linkSync(owner, marker); // O_EXCL, including an empty foreign target.
    else if (operation === "restore") fs.linkSync(marker, owner);
    else if (operation === "remove-owner") fs.unlinkSync(owner);
    else if (operation === "inspect") return;
    else fail("invalid pinned release operation");
  });
};
const ownedRelease = (base, initialized, onPhase) => {
  let released = false, markerRemoved = false, begun = false;
  const target = path.join(base, LOCK), marker = path.join(base, RELEASE);
  const ownProcess = () => {
    assertRoot(base, initialized.root);
    if (!equal(currentProcess(), initialized.owner.value.process)) fail("release process incarnation or namespace changed");
  };
  const ownMarker = () => {
    ownProcess();
    const state = pendingRelease(base, initialized.root);
    if (!state || state.current || !equal(state.owner, initialized.owner) || !same(state.lock, initialized.lock)) fail("release marker ownership changed");
    return state;
  };
  return () => {
    if (released) return;
    ownProcess();
    // A failed final fsync retries durability only, never a replacement lock.
    if (markerRemoved) { syncDirectory(base); released = true; return; }
    onPhase("release-before-remove");
    ownProcess();
    if (!pendingRelease(base, initialized.root)) {
      if (begun) fail("release marker disappeared");
      assertSnapshot(base, initialized);
      pinnedReleaseOperation(base, initialized, "release");
    }
    begun = true;
    let state = ownMarker();
    // The last owner link may be removed only after its external twin is durable.
    syncDirectory(base);
    onPhase("release-marked");
    state = ownMarker();
    if (state.hasOwner) {
      pinnedReleaseOperation(base, state, "remove-owner");
      onPhase("release-owner-removed");
    }
    state = ownMarker();
    if (state.directory) {
      onPhase("release-before-rmdir");
      state = ownMarker();
      if (!state.directory || state.hasOwner) fail("release directory changed before removal");
      fs.rmdirSync(target); // Nonrecursive: unexpected evidence always stops cleanup.
    }
    onPhase("release-directory-removed");
    state = ownMarker();
    if (state.directory || state.links !== 1) fail("release cleanup identity changed");
    syncDirectory(base);
    onPhase("release-before-marker-remove");
    assertPending(base, state);
    ownProcess();
    fs.unlinkSync(marker); // Release commit point: no lock directory remains.
    markerRemoved = true;
    syncDirectory(base);
    released = true;
  };
};
/** Read-only; never creates a lock, repairs permissions, logs or replays journals.
 * @param {string} base
 * @returns {InstallationLockInspection}
 */
export function inspectInstallationLock(base) {
  try {
    const legacy = legacyGateState(base);
    if (legacy.present) {
      /** @type {InstallationLockInspection} */
      const inspection = /** @type {any} */ ({ status: legacy.status, available: false, legacyGate: { path: path.join(base, LEGACY_LOCK), ...(legacy.owner ? { owner: legacy.owner } : {}) }, ...(legacy.reason ? { reason: legacy.reason } : {}) });
      return inspection;
    }
    const root = rootIdentity(base);
    const pending = pendingRelease(base, root);
    if (!pending) {
      try { fs.lstatSync(path.join(base, LOCK)); }
      catch (error) { if (errorCode(error) === "ENOENT") return { status: "absent", available: true }; throw error; }
    }
    const state = pending?.current ?? (pending?.hasOwner ? snapshot(base, root) : pending) ?? snapshot(base, root);
    const states = [state.owner, ...state.claims, ...(pending?.current ? [pending.owner] : [])].map(record => incarnationState(record.value.process));
    const status = states.includes("live") ? "busy" : states.includes("uncertain") ? "recovery-required" : "stale";
    /** @type {InstallationLockInspection} */
    const inspection = { status, available: false, owner: state.owner.value, claims: state.claims.length, recoverable: status === "stale" };
    if (status === "stale") {
      if (state.claims.length >= MAX_CLAIMS) return { ...inspection, recoverable: false, reason: "Recovery claim capacity reached; preserve lock and transaction evidence for operator review." };
      try {
        // A dead owner alone is insufficient: prove the same pinned-directory
        // capability recovery needs, without creating a claim or replaying data.
        const verify = () => pending ? assertPending(base, pending) : assertSnapshot(base, state);
        if (!pending || pending.directory || pending.current) {
          if (process.platform === "darwin") { runPinnedRecovery(path.join(base, LOCK), state); verify(); }
          else inOwnedDirectory(path.join(base, LOCK), state, verify);
        } else verify();
      } catch (error) {
        if (errorCode(error) !== "INSTALL_LOCK_UNSUPPORTED") throw error;
        return { ...inspection, recoverable: false, reason: "Automatic lock recovery unavailable: inode-pinned recovery capability is unsupported; preserve lock and transaction evidence for operator review." };
      }
    }
    return inspection;
  } catch (error) {
    return { status: errorCode(error) === "INSTALL_LOCK_UNSUPPORTED" ? "unsupported" : "recovery-required", available: false, reason: "Lock identity or process evidence unavailable; preserve existing material." };
  }
}

/** Bounded positive managed-process detection, not purge authorization. Call while
 * holding the shared lock after durable retirement (the transaction engine owns
 * that fence). Kernel exe dev/ino, never argv, identifies retained private Nodes.
 * A negative snapshot cannot prove visibility across PID namespaces/dumpability
 * restrictions, nor fence legacy entrypoints; inactive therefore stays FALSE.
 * macOS inspection is explicitly unsupported pending native qualification.
 * @param {{retainedNodePaths?: string[]}} [options]
 * @returns {{supported: boolean, inactive: false, active: boolean, observedPids: number[], reason: string}}
 */
export function inspectInstallationProcesses({ retainedNodePaths = [] } = {}) {
  const observedPids = [];
  const report = (supported, reason) => ({ supported, inactive: /** @type {const} */ (false), active: observedPids.length > 0, observedPids, reason });
  if (process.platform !== "linux") return report(false, "Managed-process inspection is unsupported on this platform; preserve data.");
  if (!Array.isArray(retainedNodePaths) || !retainedNodePaths.length || retainedNodePaths.length > 256) return report(false, "A complete bounded retained-Node inventory is required; automatic purge is unsupported.");
  const deadline = process.hrtime.bigint() + 2_000_000_000n;
  const checkDeadline = () => { if (process.hrtime.bigint() > deadline) fail("process inspection deadline reached"); };
  const executable = (file) => {
    checkDeadline();
    if (typeof file !== "string" || !path.isAbsolute(file) || path.resolve(file) !== file || fs.realpathSync(file) !== file || /[\x00-\x1f\x7f]/u.test(file)) fail("unsafe retained executable path");
    const stat = fs.lstatSync(file, { bigint: true });
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n || stat.uid !== BigInt(process.getuid()) || (stat.mode & 0o7777n) !== 0o700n) fail("unsafe retained executable identity");
    return { ...identity(stat), size: String(stat.size), mtime: String(stat.mtimeNs), ctime: String(stat.ctimeNs) };
  };
  try {
    const own = currentProcess();
    const retained = retainedNodePaths.map(executable);
    const pids = [];
    const directory = fs.opendirSync("/proc");
    try {
      let entry;
      let count = 0;
      while ((entry = directory.readSync())) {
        checkDeadline();
        if (++count > 8192) fail("proc directory entry bound reached");
        if (/^[1-9][0-9]{0,9}$/u.test(entry.name)) {
          if (pids.length >= 4096) fail("process inspection capacity reached");
          pids.push(Number(entry.name));
        }
      }
    } finally { directory.closeSync(); }
    let uncertain = false;
    for (const pid of pids) {
      checkDeadline();
      try {
        const before = fs.statSync(`/proc/${pid}`, { bigint: true });
        if (!before.isDirectory()) { uncertain = true; continue; }
        if (before.uid !== BigInt(process.getuid())) continue;
        const first = processSample(pid);
        if (!first) { uncertain = true; continue; }
        // Only this exact management incarnation is excluded. Other managers
        // using a retained private Node conservatively count as active too.
        if (pid === own.pid && first.start === own.start && !first.zombie) continue;
        if (first.zombie) continue;
        const firstExe = fs.statSync(`/proc/${pid}/exe`, { bigint: true });
        const second = processSample(pid);
        const secondExe = fs.statSync(`/proc/${pid}/exe`, { bigint: true });
        const after = fs.statSync(`/proc/${pid}`, { bigint: true });
        if (!equal(first, second) || !same(identity(before), identity(after)) || before.uid !== after.uid
          || !firstExe.isFile() || !same(identity(firstExe), identity(secondExe)) || liveness(pid) !== "present") { uncertain = true; continue; }
        if (retained.some(value => same(value, identity(firstExe)))) observedPids.push(pid);
      } catch { uncertain = true; }
    }
    checkDeadline();
    if (!equal(own, currentProcess()) || !equal(retained, retainedNodePaths.map(executable))) return report(false, "Process or retained executable identity changed; preserve data.");
    if (observedPids.length) return report(true, "Retained private-Node processes are active; preserve data.");
    return report(!uncertain, uncertain
      ? "Process visibility is inaccessible or unstable; inactivity is unknown, preserve data."
      : "No managed executable observed in this PID namespace; complete visibility is not qualified, automatic purge remains unsupported.");
  } catch {
    return report(false, "Bounded process inspection unavailable, exceeded, or unstable; preserve data.");
  }
}

/** @internal Observation availability only, NOT native target qualification.
 * Exported for the synthetic process-evidence model tests; the live
 * `currentProcess()` and `inspectInstallationProcesses()` definitions are
 * unchanged and no default, deadline or permission is affected.
 * @returns {{supported: boolean, platform: string, incarnation?: any, reason?: string, purge: ReturnType<typeof inspectInstallationProcesses>}} */
export function installationLockAvailability() {
  try {
    const incarnation = currentProcess();
    return { supported: true, platform: process.platform, incarnation, purge: inspectInstallationProcesses() };
  } catch {
    return { supported: false, platform: process.platform, reason: "Bounded kernel process-incarnation inspection unavailable.", purge: inspectInstallationProcesses() };
  }
}

// O_EXCL creation plus the open descriptor proves in-process partial-write cleanup
// ownership. A crash loses that evidence: the next process MUST preserve partials.
const writeControl = (target, value, onCreated, bindSelf = false) => {
  let text = `${JSON.stringify(value)}\n`;
  if (Buffer.byteLength(text) > MAX_CONTROL) fail("lock control exceeds bound");
  const fd = fs.openSync(target, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
  let owned;
  try {
    owned = identity(fs.fstatSync(fd, { bigint: true }));
    if (bindSelf) {
      value.file = owned;
      text = `${JSON.stringify(value)}\n`;
      if (Buffer.byteLength(text) > MAX_CONTROL) fail("lock control exceeds bound");
    }
    fs.fchmodSync(fd, 0o600);
    onCreated(owned);
    fs.writeFileSync(fd, text);
    fs.fsyncSync(fd);
  } catch (error) {
    // Never remove a replacement inode, link, or file with unexpected modes.
    try { if (same(identity(privateStat(target, false)), owned)) fs.unlinkSync(target); } catch {}
    throw error;
  } finally { fs.closeSync(fd); }
  return { file: owned };
};

// An absent lock directory is still fenced by the live release marker. A dead
// marker is archived only AFTER its provenance is fsynced in the new owner. A
// crash at either side therefore leaves a retryable, transaction-bound record.
const archiveRelease = (base, initialized) => {
  assertSnapshot(base, initialized);
  if (!equal(currentProcess(), initialized.owner.value.process)) fail("release recovery namespace changed");
  let pending = pendingRelease(base, initialized.root);
  if (!pending?.current || !equal(pending.current, initialized) || incarnationState(pending.owner.value.process) !== "dead") fail("release recovery ownership changed");
  const expectedOwner = pending.owner;
  const marker = path.join(base, RELEASE), quarantine = path.join(base, quarantineName(pending.owner.value));
  if (pending.links === 1) fs.linkSync(marker, quarantine); // Never overwrite a foreign archive.
  pending = pendingRelease(base, initialized.root);
  if (!pending?.current || !equal(pending.current, initialized) || !equal(pending.owner, expectedOwner) || pending.links !== 2) fail("release archive ownership changed");
  assertSnapshot(base, initialized);
  if (!equal(currentProcess(), initialized.owner.value.process)) fail("release recovery namespace changed");
  fs.unlinkSync(marker);
  syncDirectory(base);
};
// ── Legacy compatibility gate (W5) ───────────────────────────────────────────
// The reviewed legacy staged writers mkdir `.install.lock` and write a
// PID/nonce `owner.json`. `.install-lock` and `.install.lock` do NOT exclude
// each other, so updated writers acquire the legacy gate FIRST, then the modern
// lock, in one documented fixed order. Legacy evidence is PID/nonce-only or
// partial/foreign; it is NEVER auto-reclaimed and is preserved for operator
// recovery. The gate uses the reviewed legacy format, so historical legacy
// writers still see it as busy without understanding the modern lock.
const LEGACY_LOCK = ".install.lock";
const LEGACY_FIELDS = ["pid", "nonce"];

/** Read-only strict legacy-gate state. Never creates, repairs or reclaims.
 * @param {string} base
 */
const legacyGateState = (base) => {
  const target = path.join(base, LEGACY_LOCK);
  let stat;
  try { stat = fs.lstatSync(target, { bigint: true }); }
  catch (error) { return errorCode(error) === "ENOENT" ? { present: false, status: "absent" } : { present: true, valid: false, status: "recovery-required", reason: "legacy gate is unreadable; preserve for operator recovery" }; }
  if (!stat.isDirectory() || stat.isSymbolicLink()) return { present: true, valid: false, status: "recovery-required", reason: "legacy gate type or symlink is unsafe; preserve for operator recovery" };
  if (typeof process.getuid !== "function" || stat.uid !== BigInt(process.getuid()) || (stat.mode & 0o7777n) !== 0o700n) return { present: true, valid: false, status: "recovery-required", reason: "unsafe legacy gate ownership or mode; preserve for operator recovery" };
  let names;
  try { names = entries(target); }
  catch { return { present: true, valid: false, status: "recovery-required", reason: "legacy gate entry bound exceeded; preserve for operator recovery" }; }
  if (names.length === 0) return { present: true, valid: false, status: "recovery-required", reason: "partial legacy gate without an owner record; preserve for operator recovery" };
  if (names.length !== 1 || names[0] !== "owner.json") return { present: true, valid: false, status: "recovery-required", reason: "foreign entries inside legacy gate; preserve for operator recovery" };
  let owner;
  try { owner = control(path.join(target, "owner.json")); }
  catch { return { present: true, valid: false, status: "recovery-required", reason: "invalid legacy owner record; preserve for operator recovery" }; }
  const value = owner.value;
  if (!keys(value, LEGACY_FIELDS) || !Number.isSafeInteger(value.pid) || value.pid <= 0 || value.pid > 2147483647 || typeof value.nonce !== "string" || !NONCE.test(value.nonce)) {
    return { present: true, valid: false, status: "recovery-required", reason: "unrecognized legacy owner record; preserve for operator recovery" };
  }
  const record = { pid: value.pid, nonce: value.nonce };
  if (liveness(value.pid) === "present") return { present: true, valid: true, status: "busy", owner: record, reason: "legacy installation lock held by a live process" };
  return { present: true, valid: true, status: "recovery-required", owner: record, reason: "legacy lock owner is not live; PID/nonce-only evidence is never auto-reclaimed" };
};

/** Fixed-order gate acquisition: create the reviewed legacy lock atomically.
 * The canonical private root is validated BEFORE any mkdir/write. The exact gate
 * directory (dev/ino/birth), owner-file inode and owner-bytes hash are captured
 * in memory, so release can prove it deletes only what this process created.
 */
const acquireLegacyGate = (base) => {
  const root = rootIdentity(base); // Canonical private root BEFORE any creation.
  const target = path.join(base, LEGACY_LOCK);
  let created = false;
  try { fs.mkdirSync(target, { mode: 0o700 }); created = true; }
  catch (error) { if (errorCode(error) !== "EEXIST") throw error; }
  if (!created) {
    const state = legacyGateState(base);
    if (state.status === "busy") fail("another Kiro Fabric installation mutation is in progress", "INSTALL_LOCK_BUSY");
    fail("legacy installation lock evidence requires operator recovery; it is never auto-reclaimed", "INSTALL_LOCK_RECOVERY_REQUIRED");
  }
  const gateStat = privateStat(target, true);
  if (gateStat.birthtimeNs <= 0n) fail("stable legacy gate birth identity unavailable", "INSTALL_LOCK_UNSUPPORTED");
  const gateId = identity(gateStat);
  const ownerPath = path.join(target, "owner.json");
  const value = { pid: process.pid, nonce: nonce() };
  let createdOwner;
  let owner;
  try {
    if (entries(target).length) fail("new legacy gate replaced");
    writeControl(ownerPath, value, (owned) => { createdOwner = owned; });
    owner = control(ownerPath);
    if (!keys(owner.value, LEGACY_FIELDS) || owner.value.pid !== process.pid || owner.value.nonce !== value.nonce) fail("new legacy owner binding changed");
    if (!same(createdOwner, owner.file)) fail("new legacy owner inode replaced during acquisition");
    syncDirectory(target);
    syncDirectory(base);
    assertRoot(base, root); // Re-prove root ancestry after every gate write/durability step.
    const finalGate = privateStat(target, true);
    if (!same(identity(finalGate), gateId) || String(finalGate.birthtimeNs) !== String(gateStat.birthtimeNs)) fail("new legacy gate replaced");
  } catch (error) {
    // Remove only bytes this process proved it created, and only after re-proving
    // the root and gate ancestry. A replaced root or gate is foreign evidence and
    // is preserved for operator recovery, never cleaned up.
    try {
      assertRoot(base, root);
      if (createdOwner) {
        try {
          const currentOwner = fs.lstatSync(ownerPath, { bigint: true });
          if (same(identity(currentOwner), createdOwner)) fs.unlinkSync(ownerPath);
        } catch {}
      }
      const currentGate = fs.lstatSync(target, { bigint: true });
      if (same(identity(currentGate), gateId) && String(currentGate.birthtimeNs) === String(gateStat.birthtimeNs) && entries(target).length === 0) fs.rmdirSync(target);
    } catch {}
    throw error;
  }
  return { target, root, dev: String(gateStat.dev), ino: String(gateStat.ino), birth: String(gateStat.birthtimeNs), pid: process.pid, nonce: value.nonce, ownerFile: owner.file, ownerHash: owner.hash };
};

/**
 * Phase-tracked release of ONLY the exact gate this process created. Mutations
 * are recorded before their durability syncs, so a retry finishes durability
 * instead of repeating or widening removal. A durability failure after rmdir
 * reports a physically released gate whose removal fsync is uncertain.
 *
 * Late-retention contract: `shouldRetain()` is consulted before the owner unlink,
 * immediately after the `legacy-owner-removed` callback (still before the
 * physical gate removal), and again before the rmdir. A request arriving before
 * the physical removal therefore preserves the gate directory and is reported as
 * `retained` with `gateRemoved` false. A request arriving after the rmdir
 * (`legacy-gate-removed`) is too late: the run completes as a physical release
 * and never reports retention. `run()` returns the truthful outcome so callers
 * cannot report both retained and released.
 * @param {string} base @param {any} gate @param {(phase: string) => void} [onPhase] @param {() => boolean} [shouldRetain]
 */
const ownedLegacyRelease = (base, gate, onPhase = () => {}, shouldRetain = () => false) => {
  const target = path.join(base, LEGACY_LOCK);
  const ownerPath = path.join(target, "owner.json");
  let ownerRemoved = false, gateRemoved = false, retained = false, done = false;
  const run = () => {
    if (done) return { retained, ownerRemoved, gateRemoved };
    assertRoot(base, gate.root);
    if (shouldRetain()) { retained = true; done = true; return { retained, ownerRemoved, gateRemoved }; }
    if (!ownerRemoved) {
      const stat = fs.lstatSync(target, { bigint: true });
      if (!stat.isDirectory() || stat.isSymbolicLink()) fail("legacy gate type changed; preserve for recovery");
      if (!same(identity(stat), { dev: gate.dev, ino: gate.ino }) || String(stat.birthtimeNs) !== gate.birth) fail("legacy gate ownership changed; preserve for recovery");
      privateStat(target, true);
      const names = entries(target);
      if (names.length !== 1 || names[0] !== "owner.json") fail("legacy gate content changed; preserve for recovery");
      const ownerStat = fs.lstatSync(ownerPath, { bigint: true });
      if (!same(identity(ownerStat), gate.ownerFile)) fail("legacy gate owner inode changed; preserve for recovery");
      const owner = control(ownerPath);
      if (!keys(owner.value, LEGACY_FIELDS) || owner.value.pid !== gate.pid || owner.value.nonce !== gate.nonce) fail("legacy gate owner changed; preserve for recovery");
      if (owner.hash !== gate.ownerHash) fail("legacy gate owner bytes changed; preserve for recovery");
      fs.unlinkSync(ownerPath);
      ownerRemoved = true;
      onPhase("legacy-owner-removed");
      // Retention delivered by the owner-removed callback arrives BEFORE the
      // physical gate removal, so it can still preserve the gate directory.
      if (shouldRetain()) { retained = true; syncDirectory(target); syncDirectory(base); done = true; return { retained, ownerRemoved, gateRemoved }; }
    }
    if (!gateRemoved) {
      if (shouldRetain()) { retained = true; syncDirectory(target); syncDirectory(base); done = true; return { retained, ownerRemoved, gateRemoved }; }
      const after = fs.lstatSync(target, { bigint: true });
      if (!after.isDirectory() || after.isSymbolicLink()) fail("legacy gate type changed; preserve for recovery");
      if (!same(identity(after), { dev: gate.dev, ino: gate.ino }) || String(after.birthtimeNs) !== gate.birth) fail("legacy gate replaced during release; preserve for recovery");
      if (entries(target).length) fail("legacy gate gained content during release; preserve for recovery");
      fs.rmdirSync(target);
      gateRemoved = true;
      onPhase("legacy-gate-removed");
    }
    syncDirectory(base); // Final durability, reached only for the gate this process removed.
    done = true;
    return { retained, ownerRemoved, gateRemoved };
  };
  return { run, phase: () => ({ ownerRemoved, gateRemoved, retained, done }) };
};

const modernTransactionEvidence = (base) => {
  for (const name of ["active.json", "candidate.json"]) {
    try { fs.lstatSync(path.join(base, ".transactions", name)); return true; }
    catch (error) { if (errorCode(error) !== "ENOENT") return true; }
  }
  return false;
};

/**
 * Fixed-order (legacy gate THEN modern lock) fail-fast exclusion for supported
 * installation writers. Retention evidence is settled while the modern lock is
 * still held; the modern lock is then released, and the legacy gate is released
 * LAST. A late `release.retainLegacyGate()` request from a modern release
 * callback is therefore honored, and a physically released gate is never
 * reported as retained. A legacy phase callback that requests retention at
 * `legacy-owner-removed` (before the physical gate removal) preserves the gate
 * directory; a request at `legacy-gate-removed` arrives after release and cannot
 * retroactively grant exclusion, so `retainedLegacyGate` and
 * `releasedLegacyGate` are mutually exclusive. `owner`, `recovered`, `retainedLegacyGate` and
 * `releasedLegacyGate` report truthful ownership; a removal-durability failure
 * sets `legacyGateDurabilityUncertain` on the thrown error while the release is
 * already physically effective. No waits, retries or automatic legacy takeover.
 * @param {string} base
 * @param {{recover?: boolean, transactionId?: string, onPhase?: (phase: string) => void}} [options]
 * @returns {InstallationExclusionRelease}
 */
export function acquireInstallationExclusion(base, { recover = false, transactionId, onPhase = () => {} } = {}) {
  // Establish a supported own incarnation BEFORE creating any bridge state, so an
  // unsupported process identity cannot leave a legacy gate behind. The modern
  // lock re-proves it and owns the durable owner record.
  const incarnation = currentProcess();
  const gate = acquireLegacyGate(base);
  let modern;
  try {
    modern = acquireInstallationLock(base, { recover, transactionId, onPhase });
  } catch (error) {
    // Modern acquisition failed before any protected interval. Release only the
    // gate this process proved it created, and only when no unresolved modern
    // transaction evidence remains.
    let retain = true;
    const legacy = ownedLegacyRelease(base, gate, () => {});
    try {
      if (!modernTransactionEvidence(base)) {
        legacy.run();
        retain = false;
      }
    } catch (releaseError) {
      const phase = legacy.phase();
      if (phase.gateRemoved) {
        retain = false;
        error.legacyGateReleased = true;
        error.legacyGateDurabilityUncertain = true;
      } else {
        error.legacyGateReleaseError = releaseError;
      }
    }
    if (retain) { error.legacyGateRetained = true; error.legacyGate = gate.target; }
    throw error;
  }
  // The gate was proven against the root before creation; the modern lock proves
  // its own root again. Refuse to admit a bridge whose two halves observed
  // different roots or process incarnations, preserving all evidence.
  if (!same(modern.owner.root, gate.root)) {
    fail("installation root changed between legacy gate and modern lock; preserve all evidence for recovery", "INSTALL_LOCK_RECOVERY_REQUIRED");
  }
  if (!equal(modern.owner.process, incarnation)) {
    fail("installation process incarnation changed between legacy gate and modern lock; preserve all evidence for recovery", "INSTALL_LOCK_RECOVERY_REQUIRED");
  }
  const state = { gateReleased: false, gateDurabilityUncertain: false, gateRetained: false, finished: false, releasing: false };
  const legacy = ownedLegacyRelease(base, gate, onPhase, () => state.gateRetained);
  const release = /** @type {any} */ ((options = {}) => {
    if (state.finished || state.releasing) return release; // Reentrant calls never release twice.
    state.releasing = true;
    try {
      // Physically released already: only the removal durability fsync remains.
      // Never inspect or touch a possible replacement gate.
      if (state.gateReleased) {
        try { legacy.run(); state.gateDurabilityUncertain = false; }
        catch (error) {
          state.gateDurabilityUncertain = true;
          error.legacyGateReleased = true;
          error.legacyGateDurabilityUncertain = true;
          error.legacyGateRetained = false;
          error.legacyGate = gate.target;
          throw error;
        }
        state.finished = true;
        return release;
      }
      // Settle retention while the modern lock is STILL HELD. Reading transaction
      // evidence after unlocking modern would be unprotected, so it happens here.
      let retain = options.retainLegacyGate === true || state.gateRetained;
      if (!retain && modernTransactionEvidence(base)) retain = true;
      try { modern(); }
      catch (error) {
        state.gateRetained = true;
        error.legacyGateRetained = true;
        error.legacyGate = gate.target;
        throw error; // Modern state uncertain: keep the legacy gate; retry may finish modern durability.
      }
      // A late retain request from the modern release callback is honored because
      // the legacy gate is always released LAST, after modern cleanup.
      if (state.gateRetained) retain = true;
      if (retain) {
        state.gateRetained = true;
        state.finished = true;
        return release;
      }
      try {
        const outcome = legacy.run();
        if (outcome.retained) {
          // A late retention request delivered by a legacy release callback before
          // the physical gate removal preserves the directory. The owner may
          // already be gone (partial gate); exclusion still holds for legacy
          // writers via the existing directory. Never report release here.
          state.gateRetained = true;
          state.finished = true;
          return release;
        }
        state.gateReleased = true;
        state.finished = true;
      }
      catch (error) {
        const phase = legacy.phase();
        if (phase.gateRemoved) {
          // The gate directory is physically gone: exclusion is not retained, but
          // its removal durability fsync is still uncertain. Retry finishes only
          // that fsync and never removes a replacement.
          state.gateReleased = true;
          state.gateDurabilityUncertain = true;
          error.legacyGateReleased = true;
          error.legacyGateDurabilityUncertain = true;
          error.legacyGateRetained = false;
        } else {
          state.gateRetained = true;
          error.legacyGateRetained = true;
        }
        error.legacyGate = gate.target;
        throw error;
      }
      return release;
    } finally { state.releasing = false; }
  });
  Object.defineProperties(release, {
    owner: { value: modern.owner, enumerable: true },
    recovered: { value: modern.recovered, enumerable: true },
    retainedLegacyGate: { get: () => state.gateRetained },
    releasedLegacyGate: { get: () => state.gateReleased },
    legacyGate: { value: gate.target, enumerable: true },
  });
  release.retainLegacyGate = () => {
    if (state.finished || state.gateReleased) return;
    // A physically released gate cannot retroactively grant exclusion. The legacy
    // phase tracker distinguishes the owner-removed (preservable) boundary from
    // the gate-removed (already released) boundary.
    if (legacy.phase().gateRemoved) return;
    state.gateRetained = true;
  };
  return release;
}

/**
 * Synchronous, fail-fast shared mutation/startup-admission lock. Startup uses
 * recover:false and holds it THROUGH launch validation and durable-data admission.
 * recover:true only reclaims proven-dead lock ownership, NOT transaction data.
 * New owners self-bind their file and stable directory birth identity. Release
 * keeps that exact inode in an exclusive external marker until cleanup commits;
 * interrupted-release provenance remains durable through recovery handoff.
 * Filesystems without stable positive directory birth times fail closed.
 * Caller MUST reconcile journals under the returned lock, even when recovered is
 * empty (a previous reclaimer may have died just after quarantine).
 * @param {string} base existing canonical owned 0700 installation root
 * @param {{recover?: boolean, transactionId?: string, onPhase?: (phase: string) => void}} options
 * @returns {InstallationLockRelease}
 */
export function acquireInstallationLock(base, { recover = false, transactionId, onPhase = () => {} } = {}) {
  if (typeof recover !== "boolean" || typeof onPhase !== "function" || (transactionId !== undefined && (typeof transactionId !== "string" || !TRANSACTION.test(transactionId)))) fail("invalid installation lock options", "INSTALL_LOCK_USAGE");
  const root = rootIdentity(base);
  const incarnation = currentProcess(); // Before creating ANY installation state.
  const target = path.join(base, LOCK);
  const recovered = [];
  for (let attempt = 0; attempt < 4; attempt++) {
    assertRoot(base, root);
    let pending = pendingRelease(base, root);
    if (pending) {
      const status = incarnationState(pending.owner.value.process);
      if (status === "live") fail("installation lock busy", "INSTALL_LOCK_BUSY");
      if (status !== "dead") fail("installation release incarnation uncertain; preserve for recovery");
      if (!recover) fail("dead installation lock requires explicit recovery");
      if (pending.directory && !pending.hasOwner) {
        // Restore the SAME inode, keeping the external marker through claims,
        // quarantine, and durable replacement ownership. Even a crash just after
        // quarantine must not lose a committed transaction's retry provenance.
        const restoring = pending;
        onPhase("release-recovery-before-restore");
        assertPending(base, restoring);
        if (!equal(currentProcess(), incarnation) || incarnationState(restoring.owner.value.process) !== "dead") fail("release restoration namespace changed");
        try {
          pinnedReleaseOperation(base, pending, "restore");
        } catch (error) {
          if (errorCode(error) === "INSTALL_LOCK_UNSUPPORTED") throw Object.assign(error, { recoveryRequired: true });
          throw error;
        }
        pending = pendingRelease(base, root);
        if (!pending?.directory || !pending.hasOwner || !equal(pending.owner, restoring.owner) || !same(pending.lock, restoring.lock)
          || !equal(currentProcess(), incarnation) || incarnationState(restoring.owner.value.process) !== "dead") fail("release restoration changed");
        syncDirectory(target);
        assertPending(base, pending);
        syncDirectory(base);
        onPhase("release-recovery-restored");
      }
      if (!pending.directory && !pending.current) remember(recovered, pending.owner.value, binding(pending.owner));
    }
    let created = false;
    try { fs.mkdirSync(target, { mode: 0o700 }); created = true; }
    catch (error) { if (errorCode(error) !== "EEXIST") throw error; }
    if (created) {
      const lockStat = fs.lstatSync(target, { bigint: true }), lock = identity(lockStat);
      let initialized;
      try {
        privateStat(target, true);
        if (lockStat.birthtimeNs <= 0n) fail("stable directory birth identity unavailable", "INSTALL_LOCK_UNSUPPORTED");
        onPhase("lock-created");
        assertRoot(base, root);
        if (!same(identity(privateStat(target, true)), lock) || entries(target).length) fail("new installation lock replaced");
        const value = { schema: 1, kind: "kiro-fabric-install-lock", root, lock, nonce: nonce(), process: incarnation, transactionId: transactionId ?? null, lockBirth: String(lockStat.birthtimeNs), ...(recovered.length ? { recovered: [...recovered] } : {}) };
        writeControl(path.join(target, "owner.json"), value, () => onPhase("owner-created"), true);
        const candidate = snapshot(base, root);
        if (!same(candidate.lock, lock) || !equal(candidate.owner.value, value) || candidate.claims.length) fail("new installation lock ownership changed");
        initialized = candidate;
        syncDirectory(target);
        syncDirectory(base);
        onPhase("owner-initialized");
        assertSnapshot(base, initialized);
        if (pendingRelease(base, root)) {
          onPhase("release-recovery-before-archive");
          archiveRelease(base, initialized);
          onPhase("release-recovery-archived");
        }
        const release = ownedRelease(base, initialized, onPhase);
        onPhase("acquired");
        assertSnapshot(base, initialized);
        return Object.assign(release, { recovered: recovered.map(({ quarantine, owner }) => ({ quarantine, owner })), owner: value });
      } catch (error) {
        try {
          assertRoot(base, root);
          if (!same(identity(privateStat(target, true)), lock)) throw error;
          if (initialized) ownedRelease(base, initialized, () => {})();
          else if (entries(target).length === 0) fs.rmdirSync(target);
        } catch {}
        throw error;
      }
    }
    let stale;
    try { stale = snapshot(base, root); }
    catch { fail("installation lock is uninitialized, changed or foreign; preserve for recovery"); }
    const records = [stale.owner, ...stale.claims];
    const states = records.map(record => incarnationState(record.value.process));
    if (states.includes("live")) fail("installation lock busy", "INSTALL_LOCK_BUSY");
    if (states.includes("uncertain")) fail("installation lock incarnation uncertain; preserve for recovery");
    if (!recover) fail("dead installation lock requires explicit recovery");
    if (stale.claims.length >= MAX_CLAIMS) fail("recovery claim capacity reached; preserve for recovery");
    const index = stale.claims.length;
    const value = { schema: 1, kind: "kiro-fabric-lock-recovery", nonce: nonce(), process: incarnation,
      owner: binding(stale.owner), previous: binding(records[records.length - 1]), index, quarantine: quarantineName(stale.owner.value) };
    assertSnapshot(base, stale);
    try {
      if (process.platform === "darwin") {
        onPhase("recovery-before-claim");
        const created = runPinnedRecovery(target, stale, { operation: "create" });
        onPhase("recovery-claim-created");
        runPinnedRecovery(target, stale, { operation: "publish", created, text: `${JSON.stringify(value)}\n` });
      } else {
        inOwnedDirectory(target, stale, (anchored) => {
          onPhase("recovery-before-claim");
          writeControl(path.join(anchored, claimName(index)), value, () => onPhase("recovery-claim-created"));
        });
      }
    } catch (error) {
      if (errorCode(error) === "EEXIST") fail("installation lock recovery busy", "INSTALL_LOCK_BUSY");
      // Unlike an unsupported pristine startup, this failure has known stale
      // installation evidence. The manager must report recovery, not retryable setup.
      if (errorCode(error) === "INSTALL_LOCK_UNSUPPORTED") throw Object.assign(error, { recoveryRequired: true });
      throw error;
    }
    // Claims remain if this process dies or throws after initialization. A live
    // reclaimer cannot be superseded; a dead one gets a NEW exact chained claim,
    // never pathname deletion/recreation of the old claim.
    const claimed = snapshot(base, root);
    if (!equal(claimed.owner, stale.owner) || !same(claimed.lock, stale.lock)
      || claimed.claims.length !== index + 1 || !equal(claimed.claims[index].value, value)
      || !equal(claimed.claims.slice(0, index), stale.claims)) fail("recovery claim ownership changed");
    syncDirectory(target);
    onPhase("recovery-claim-initialized");
    onPhase("recovery-before-quarantine");
    assertSnapshot(base, claimed);
    if (records.some(record => incarnationState(record.value.process) !== "dead")) fail("stale incarnation evidence changed");
    const quarantine = path.join(base, value.quarantine);
    try { fs.lstatSync(quarantine); fail("recovery quarantine already exists; preserve both identities"); }
    catch (error) { if (errorCode(error) !== "ENOENT") throw error; }
    assertSnapshot(base, claimed);
    fs.renameSync(target, quarantine);
    syncDirectory(base);
    remember(recovered, stale.owner.value, stale.linkedRelease ? binding(stale.owner) : undefined);
    onPhase("recovery-quarantined");
    // The new .install-lock arbitrates recovery with managers that arrived after
    // the move. A losing reclaimer NEVER deletes the winner's replacement lock.
  }
  fail("installation lock contention bound reached", "INSTALL_LOCK_BUSY");
}
