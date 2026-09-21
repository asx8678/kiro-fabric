// Guest bootstrap source, evaluated verbatim inside the QuickJS context
// before guest code runs. It freezes captured primordials, disables dynamic
// code generation, installs bounded bridge facades, and returns { run, cancel }.
// Keep this source framework-free: it is plain sandbox JavaScript.
export const GUEST_SETUP = `
(() => {
  'use strict';
  const bridge = globalThis.__fabricHostCall;
  const prepareHostCall = globalThis.__fabricPrepareHostCall;
  delete globalThis.__fabricHostCall;
  delete globalThis.__fabricPrepareHostCall;

  // Capture every validator/promise primordial before guest code can mutate it.
  const apply = Reflect.apply;
  const ownKeys = Reflect.ownKeys;
  const objectGetPrototypeOf = Object.getPrototypeOf;
  const objectPrototype = Object.prototype;
  const arrayPrototype = Array.prototype;
  const objectGetOwnPropertyDescriptors = Object.getOwnPropertyDescriptors;
  const objectHasOwn = Object.hasOwn;
  const objectKeys = Object.keys;
  const objectCreate = Object.create;
  const objectDefineProperty = Object.defineProperty;
  const objectFreeze = Object.freeze;
  const arrayIsArray = Array.isArray;
  const numberIsFinite = Number.isFinite;
  const stringCharCodeAt = String.prototype.charCodeAt;
  const jsonParse = JSON.parse;
  const jsonStringify = JSON.stringify;
  const weakHas = WeakSet.prototype.has;
  const weakAdd = WeakSet.prototype.add;
  const weakDelete = WeakSet.prototype.delete;
  const promiseThenMethod = Promise.prototype.then;
  const promiseResolveMethod = Promise.resolve;
  const promiseRaceMethod = Promise.race;
  const promiseAllMethod = Promise.all;
  const SafePromise = Promise;
  const SafeArray = Array;
  const SafeWeakSet = WeakSet;
  const SafeTypeError = TypeError;
  const SafeRangeError = RangeError;
  const SafeError = Error;
  const mathFloor = Math.floor;
  const mathMin = Math.min;
  const promiseThen = (promise, fulfilled, rejected) => apply(promiseThenMethod, promise, [fulfilled, rejected]);
  const promiseResolve = (value) => apply(promiseResolveMethod, SafePromise, [value]);
  const promiseRace = (values) => apply(promiseRaceMethod, SafePromise, [values]);
  const promiseAll = (values) => apply(promiseAllMethod, SafePromise, [values]);
  const configuredParallelLimit = globalThis.__fabricMaxParallelConcurrency;
  delete globalThis.__fabricMaxParallelConcurrency;
  if (typeof configuredParallelLimit !== 'number' || !numberIsFinite(configuredParallelLimit) || configuredParallelLimit < 1) {
    throw new SafeTypeError('Fabric parallel limit is invalid');
  }
  const maxParallelConcurrency = mathFloor(configuredParallelLimit);

  const codeGenerationDenied = function () { throw new SafeTypeError('Dynamic code generation is disabled'); };
  const constructors = [
    Function,
    objectGetPrototypeOf(function* () {}).constructor,
    objectGetPrototypeOf(async function () {}).constructor,
    objectGetPrototypeOf(async function* () {}).constructor,
  ];
  for (const constructor of constructors) {
    objectDefineProperty(constructor.prototype, 'constructor', {
      value: codeGenerationDenied, writable: false, configurable: false,
    });
  }
  objectDefineProperty(globalThis, 'eval', { value: codeGenerationDenied, writable: false, configurable: false });
  objectDefineProperty(globalThis, 'Function', { value: codeGenerationDenied, writable: false, configurable: false });

  // ECMAScript array indices stop at 2^32-2 (the maximum is 2^32-2, not 2^32-1).
  // A larger all-digit key is an ordinary property that JSON serialization drops
  // from the element list, so accepting it would let the guest return a value the
  // host-side validator rejects and hide data from the caller.
  const MAX_ARRAY_INDEX = '4294967294';
  const arrayIndex = (key) => {
    if (key === '0') return true;
    if (!key || key[0] === '0') return false;
    for (let index = 0; index < key.length; index++) {
      const code = apply(stringCharCodeAt, key, [index]);
      if (code < 48 || code > 57) return false;
    }
    return key.length < MAX_ARRAY_INDEX.length
      || (key.length === MAX_ARRAY_INDEX.length && key <= MAX_ARRAY_INDEX);
  };
  const strictJsonText = (root) => {
    const seen = new SafeWeakSet();
    let nodes = 0;
    const visit = (value, depth) => {
      if (++nodes > 100000 || depth > 64) throw new SafeTypeError('Result exceeds strict JSON structural limits');
      if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
      if (typeof value === 'number') {
        if (!numberIsFinite(value)) throw new SafeTypeError('Result contains a non-finite number');
        return value;
      }
      if (typeof value !== 'object') throw new SafeTypeError('Result contains a non-JSON value');
      if (apply(weakHas, seen, [value])) throw new SafeTypeError('Result contains a cycle');
      const prototype = objectGetPrototypeOf(value);
      if (prototype !== objectPrototype && prototype !== arrayPrototype && prototype !== null) {
        throw new SafeTypeError('Result contains an unsupported exotic object');
      }
      apply(weakAdd, seen, [value]);
      const descriptors = objectGetOwnPropertyDescriptors(value);
      for (const key of ownKeys(descriptors)) if (typeof key === 'symbol') throw new SafeTypeError('Result contains a symbol key');
      let copy;
      if (arrayIsArray(value)) {
        copy = [];
        for (const key of objectKeys(descriptors)) {
          if (key !== 'length' && !arrayIndex(key)) throw new SafeTypeError('Result contains a non-index array property');
        }
        for (let index = 0; index < value.length; index++) {
          const descriptor = descriptors[index];
          if (!descriptor || !objectHasOwn(descriptor, 'value')) throw new SafeTypeError('Result contains an accessor or sparse array');
          objectDefineProperty(copy, index, { value: visit(descriptor.value, depth + 1), enumerable: true, writable: true, configurable: true });
        }
      } else {
        copy = objectCreate(null);
        for (const key of objectKeys(descriptors)) {
          const descriptor = descriptors[key];
          if (!objectHasOwn(descriptor, 'value')) throw new SafeTypeError('Result contains an accessor');
          objectDefineProperty(copy, key, { value: visit(descriptor.value, depth + 1), enumerable: true });
        }
      }
      apply(weakDelete, seen, [value]);
      return copy;
    };
    const text = apply(jsonStringify, JSON, [visit(root, 0)]);
    if (typeof text !== 'string' || text.length > 8000000) throw new SafeTypeError('Result exceeds strict JSON byte limit');
    return text;
  };
  const parseStrict = (text) => apply(jsonParse, JSON, [text]);
  // Bounded print formatting runs inside the VM: an over-cap string is sliced
  // here so the host never copies the whole value across the bridge. Mirrors the
  // host formatter's JSON shape for non-strings and never throws.
  const boundLog = (value, maxChars) => {
    if (typeof maxChars !== 'number' || !numberIsFinite(maxChars) || maxChars <= 0) return '';
    if (typeof value === 'string') return value.length <= maxChars ? value : value.slice(0, maxChars);
    let text;
    try { text = strictJsonText(value); }
    catch { text = '[value outside bounded JSON]'; }
    return text.length <= maxChars ? text : text.slice(0, maxChars);
  };
  // One execution-wide semaphore covers friendly APIs, tools.call, direct
  // Promise.all fan-out, and nested parallel helpers alike. This queues excess
  // bridge work before it reaches the host's fail-closed concurrency quota.
  const hostCallWaiters = objectCreate(null);
  let activeHostCalls = 0;
  let hostWaiterHead = 0;
  let hostWaiterTail = 0;
  let hostCallsStopped = false;
  let hostCallsStopReason;
  const acquireHostCall = () => {
    if (hostCallsStopped) {
      return new SafePromise((_resolve, reject) => reject(hostCallsStopReason));
    }
    if (activeHostCalls < maxParallelConcurrency) {
      activeHostCalls += 1;
      return promiseResolve();
    }
    return new SafePromise((resolve, reject) => {
      hostCallWaiters[hostWaiterTail++] = { resolve, reject };
    });
  };
  const releaseHostCall = () => {
    if (!hostCallsStopped && hostWaiterHead < hostWaiterTail) {
      const waiter = hostCallWaiters[hostWaiterHead];
      delete hostCallWaiters[hostWaiterHead++];
      waiter.resolve();
      return;
    }
    activeHostCalls -= 1;
  };
  const stopQueuedHostCalls = (reason) => {
    if (hostCallsStopped) return;
    hostCallsStopped = true;
    hostCallsStopReason = reason;
    while (hostWaiterHead < hostWaiterTail) {
      const waiter = hostCallWaiters[hostWaiterHead];
      delete hostCallWaiters[hostWaiterHead++];
      waiter.reject(reason);
    }
  };
  const call = (ref, args = {}) => {
    // Snapshot and validate at API invocation, before a saturated semaphore
    // can defer the bridge. Later guest mutation must not change exact args.
    const argsText = strictJsonText(args);
    prepareHostCall(ref, argsText);
    return promiseThen(acquireHostCall(), () => {
      let operation;
      try {
        operation = promiseThen(bridge(ref, argsText), parseStrict);
      } catch (error) {
        releaseHostCall();
        throw error;
      }
      return promiseThen(operation, (value) => {
        releaseHostCall();
        return value;
      }, (error) => {
        releaseHostCall();
        throw error;
      });
    });
  };
  const parallel = async (items, mapperOrOptions, maybeOptions) => {
    if (!arrayIsArray(items)) throw new SafeTypeError('parallel expects an array');
    const mapped = typeof mapperOrOptions === 'function';
    if (!mapped) {
      for (let index = 0; index < items.length; index++) {
        if (typeof items[index] !== 'function') {
          throw new SafeTypeError('parallel expects functions or an item mapper');
        }
      }
    }
    const itemCount = items.length;
    if (itemCount === 0) return [];
    const options = mapped ? maybeOptions : mapperOrOptions;
    const requested = typeof options === 'number'
      ? options
      : options && typeof options === 'object' && options.concurrency !== undefined
        ? options.concurrency
        : maxParallelConcurrency;
    if (typeof requested !== 'number' || !numberIsFinite(requested) || requested < 1) {
      throw new SafeRangeError('parallel concurrency must be a positive finite number');
    }
    const concurrency = mathMin(itemCount, maxParallelConcurrency, mathFloor(requested));
    const results = new SafeArray(itemCount);
    const workers = new SafeArray(concurrency);
    let cursor = 0;
    let stopped = false;
    for (let worker = 0; worker < concurrency; worker++) {
      workers[worker] = (async () => {
        while (!stopped && cursor < itemCount) {
          const index = cursor++;
          try {
            results[index] = mapped
              ? await apply(mapperOrOptions, undefined, [items[index], index])
              : await apply(items[index], undefined, []);
          } catch (error) {
            stopped = true;
            throw error;
          }
        }
      })();
    }
    await promiseAll(workers);
    return results;
  };
  let rejectExecution;
  const executionGate = new SafePromise((_resolve, reject) => { rejectExecution = reject; });
  const cancel = (message) => {
    const reason = new SafeError(message);
    stopQueuedHostCalls(reason);
    rejectExecution(reason);
  };
  const run = (main) => promiseThen(promiseRace([promiseThen(promiseResolve(), main), executionGate]), strictJsonText);
  globalThis.tools = objectFreeze({
    providers: () => call("fabric.providers"),
    list: () => call("fabric.list"),
    listPage: (args = {}) => call("fabric.listPage", args),
    searchPage: (args) => call("fabric.searchPage", args),
    describePage: (args) => call("fabric.describePage", args),
    search: (input) => call("fabric.search", typeof input === "string" ? { query: input } : input),
    describe: (input) => call("fabric.describe", typeof input === "string" ? { ref: input } : input),
    call: (input) => call("fabric.call", input),
  });
  globalThis.fabric = objectFreeze({
    info: () => call("fabric.info"), help: (args) => call("fabric.help", args),
    workspace: (args) => call("fabric.workspace", args),
  });
  // Guest composition only: both calls retain registry validation, read approvals,
  // quotas and cancellation. Never auto-drain search pages or read continuations.
  const searchRead = async (input) => {
    const args = parseStrict(strictJsonText(input));
    if (!args || typeof args !== 'object' || arrayIsArray(args)) throw new SafeTypeError('local.searchRead expects an object');
    const { contextLines = 3, maxWindows = 8, maxChars, ...query } = args;
    const integerInRange = (value, min, max) => typeof value === 'number' && numberIsFinite(value) && mathFloor(value) === value && value >= min && value <= max;
    if (!integerInRange(contextLines, 0, 50)) throw new SafeRangeError('local.searchRead contextLines must be an integer in 0..50');
    if (!integerInRange(maxWindows, 1, 32)) throw new SafeRangeError('local.searchRead maxWindows must be an integer in 1..32');
    if (maxChars !== undefined && !integerInRange(maxChars, 1000, 40000)) throw new SafeRangeError('local.searchRead maxChars must be an integer in 1000..40000');
    if (objectHasOwn(query, 'paginate') || objectHasOwn(query, 'cursor') || objectHasOwn(query, 'snapshotScope')) throw new SafeTypeError('local.searchRead does not paginate; use local.grep for search pages');
    const search = await call('local.grep', query);
    const byPath = objectCreate(null);
    for (const match of search.matches) {
      if (!objectHasOwn(byPath, match.path)) byPath[match.path] = [];
      byPath[match.path].push(match.line);
    }
    const windows = [];
    const append = (path, start, end) => {
      for (let offset = start; offset <= end; offset += 2000) {
        windows.push({ path, offset, limit: mathMin(2000, end - offset + 1) });
      }
    };
    for (const path of objectKeys(byPath).sort()) {
      const lines = byPath[path].sort((left, right) => left - right);
      let start = 0, end = 0;
      for (const line of lines) {
        const from = line > contextLines ? line - contextLines : 1, to = line + contextLines;
        if (start && from <= end + 1) { if (to > end) end = to; continue; }
        if (start) append(path, start, end);
        start = from; end = to;
      }
      if (start) append(path, start, end);
    }
    const selected = windows.slice(0, maxWindows), deferred = windows.slice(maxWindows);
    const read = selected.length
      ? await call('local.readMany', { windows: selected, ...(maxChars === undefined ? {} : { maxChars }) })
      : { files: [], remaining: [], complete: true, unreadTails: [] };
    // Preserve observed snapshots for later windows on already-read files.
    const hashes = objectCreate(null);
    for (const file of read.files) hashes[file.path] = file.sha256;
    for (const window of deferred) if (objectHasOwn(hashes, window.path)) window.expectedSha256 = hashes[window.path];
    // Unlike a single readMany response, this backlog may exceed 32 windows.
    // Return all of it; callers continue in <=32-window chunks, never by re-searching.
    return { ...search, ...read, remaining: [...read.remaining, ...deferred], complete: read.complete && deferred.length === 0 };
  };
  globalThis.local = objectFreeze({
    read: (args) => call("local.read", args), grep: (args) => call("local.grep", args),
    readMany: (args) => call("local.readMany", args),
    readEvidence: (args) => call("local.readEvidence", args),
    find: (args) => call("local.find", args), list: (args = {}) => call("local.list", args),
    write: (args) => call("local.write", args), edit: (args) => call("local.edit", args),
    shell: (args) => call("local.shell", args), searchRead,
  });
  const focusRead = async (input) => {
    const args = parseStrict(strictJsonText(input));
    if (!args || typeof args !== 'object' || arrayIsArray(args)) throw new SafeTypeError('repo.focusRead expects an object');
    const { maxWindows = 4, maxChars = 14000, partial = true, ...query } = args;
    const integerInRange = (value, min, max) => typeof value === 'number' && numberIsFinite(value) && mathFloor(value) === value && value >= min && value <= max;
    if (!integerInRange(maxWindows, 1, 32) || !integerInRange(maxChars, 1000, 40000) || typeof partial !== 'boolean') throw new SafeRangeError('Invalid repo.focusRead read budget');
    const navigation = await call('repo.focus', query);
    // The snapshot hash is mandatory when supplied. Never remove a stale hash
    // and reread old line numbers; return the reader failure and refresh focus.
    const windows = navigation.reads.slice(0, maxWindows);
    const sources = windows.length ? await call('local.readMany', { windows, maxChars, partial }) : null;
    return { navigation, sources, deferredReads: navigation.reads.slice(maxWindows) };
  };
  const repoGrep = async (input) => {
    const args = parseStrict(strictJsonText(input));
    if (!args || typeof args !== 'object' || arrayIsArray(args) || typeof args.pattern !== 'string') throw new SafeTypeError('repo.grep expects a search object');
    // Local contracts validate every option. Keep exact matching separate from
    // hints, and never reinterpret native regex/glob/cursor semantics.
    const settings = await call('repo.settings', {});
    const mode = settings.config.tools.grepMode;
    const symbolLike = /^[A-Za-z_$][A-Za-z0-9_$]*(?:[.#:][A-Za-z_$][A-Za-z0-9_$]*)*$/.test(args.pattern) || /^(?:[.][/]|[/])?[A-Za-z0-9_@.-]+(?:[/][A-Za-z0-9_@.{}:$-]+)+$/.test(args.pattern);
    const bare = objectKeys(args).length === 1;
    let advisory = null, diagnostic;
    const hint = async () => {
      try { const value = await call('repo.augment', { query: args.pattern, ...(args.path === undefined ? {} : {path: args.path}), maxTokens: settings.config.tools.grepAugmentBudget }); return value.status === 'ok' ? value : null; }
      catch (_) { diagnostic = 'Graph hint unavailable; exact native search remains authoritative.'; return null; }
    };
    if (mode === 'replace' && bare && symbolLike) {
      advisory = await hint();
      if (advisory) return { native: null, advisory, replacement: true };
    }
    const native = await call('local.grep', args);
    if (mode === 'augment' && symbolLike) advisory = await hint();
    return { native, advisory, replacement: false, ...(diagnostic ? { diagnostic } : {}) };
  };
  globalThis.repo = objectFreeze({
    status: (args = {}) => call('repo.status', args), sketch: (args = {}) => call('repo.sketch', args),
    focus: (args) => call('repo.focus', args), augment: (args) => call('repo.augment', args), grep: repoGrep, dwell: (args = {}) => call('repo.dwell', args),
    impact: (args = {}) => call('repo.impact', args), result: (args) => call('repo.result', args),
    searchResult: (args) => call('repo.searchResult', args), anchors: (args = {}) => call('repo.anchors', args),
    rules: (args = {}) => call('repo.rules', args), adoptRules: (args) => call('repo.adoptRules', args),
    settings: (args = {}) => call('repo.settings', args), configure: (args) => call('repo.configure', args),
    reset: (args = {}) => call('repo.reset', args), reload: (args = {}) => call('repo.reload', args),
    sync: (args = {}) => call('repo.sync', args), focusRead,
  });
  globalThis.review = objectFreeze({
    begin: (args) => call("review.begin", args), update: (args) => call("review.update", args),
    finding: (args) => call("review.finding", args), status: (args) => call("review.status", args),
    reconcile: (args) => call("review.reconcile", args), end: (args) => call("review.end", args),
  });
  globalThis.probe = objectFreeze({
    discover: (args) => call("probe.discover", args), create: (args) => call("probe.create", args),
    write: (args) => call("probe.write", args), run: (args) => call("probe.run", args),
  });
  globalThis.artifacts = objectFreeze({ read: (args) => call("artifacts.read", args), checkpoint: (args) => call("artifacts.checkpoint", args) });
  globalThis.memory = objectFreeze({
    get: (args) => call("memory.get", args), set: (args) => call("memory.set", args),
    delete: (args) => call("memory.delete", args), search: (args) => call("memory.search", args),
    index: (args = {}) => call("memory.index", args),
  });
  globalThis.continuity = objectFreeze({
    create: (args) => call("continuity.create", args), checkpoint: (args) => call("continuity.checkpoint", args),
    read: (args) => call("continuity.read", args), recall: (args) => call("continuity.recall", args), list: (args = {}) => call("continuity.list", args),
    expand: (args) => call("continuity.expand", args), handoff: (args) => call("continuity.handoff", args), delete: (args) => call("continuity.delete", args),
  });
  globalThis.state = objectFreeze({
    get: (args) => call("state.get", args), set: (args) => call("state.set", args),
    list: (args = {}) => call("state.list", args), delete: (args) => call("state.delete", args),
  });
  globalThis.web = objectFreeze({
    search: (args) => call("web.search", args), open: (args) => call("web.open", args),
  });
  globalThis.mcp = objectFreeze({
    servers: (args = {}) => call("mcp.$servers", args),
    tools: (args) => call("mcp.$tools", args),
    toolsPage: (args) => call("mcp.$toolsPage", args),
    describePage: (args) => call("mcp.$describePage", args),
    describe: (args) => call("mcp.$describe", args),
    call: (args) => call("mcp.$call", args),
  });
  objectDefineProperty(globalThis, 'parallel', { value: parallel, writable: false, configurable: false });
  objectFreeze(globalThis.payloads);
  return objectFreeze({ run, cancel, boundLog });
})()
`;
