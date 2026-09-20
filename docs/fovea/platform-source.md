# Scope-safe platform source access

## Status and ownership

Remaining-work item 3 now includes shared source policy, the Darwin adapter,
**implemented POSIX native binding source**, and direct Linux compilation/probes
of that source. This is no longer only an injected/mock native contract.
Production Linux remains wired to its existing proc-descriptor backend;
production Darwin stays fail-closed until owner-approved native loading and
packaging are integrated:

- error class: `SourcePlatformUnavailableError`
- code: `FOVEA_SOURCE_PLATFORM_UNAVAILABLE`
- platform: `darwin`
- prerequisite: `missing trusted native openat/fdopendir binding
  (DarwinSourceBinding ABI 1); /dev/fd is not a substitute`

Node does not expose `openat` or descriptor-relative directory enumeration.
Darwin's `/dev/fd` does **not** provide Linux `/proc/self/fd/<dirfd>/<child>`
semantics. `realpath`/`lstat` followed by a pathname open, directory `chdir`, and
pathname enumeration followed by identity checks are not substitutes: they can
read outside the approved root before detecting an ancestor replacement.

The native contract was proposed to the integration owner before packaging
changes. At the owner's follow-up request, the credential-free C/N-API source is
implemented and compiled with local Node headers in **fixture-only** storage.
No production loader, artifact manifest, dependency, shared build script, or
release wiring is changed. Native Darwin execution is **environment-blocked**
(this host is Linux). Remaining prerequisites are native-code review, trusted
loading/packaging, and real macOS qualification, not writing the binding source.
Linux native probes, contract fixtures and parser pins do not establish macOS
readiness.

### Files

- `src/fovea/source-access.ts`: shared capture and Git metadata policy;
  unchanged production function signatures; trusted-host `SourceAccess` class.
- `src/fovea/source-platform.ts`: capability interface, Linux backend, explicit
  platform prerequisite error, component validation, held-ancestor traversal,
  bounded reads and budgets.
- `src/fovea/source-platform-darwin.ts`: `DarwinSourceBinding` ABI 1 and
  `createDarwinSourcePlatform(binding)`; host-only dependency injection.
- `tests/fovea/source-platform.test.ts`: actual Linux filesystem probes, also
  applied through an explicitly Linux-backed Darwin contract bridge.
- `tests/fovea/source-platform-bounds.test.ts`: platform-neutral contract,
  bounds, short-read allocation, race metadata and cleanup tests.
- `src/fovea/source-platform-native.c`: N-API 8 / POSIX implementation;
  asynchronous read-only descriptor operations, opaque capabilities, bounded
  buffers, errno preservation, explicit/finalizer cleanup. Darwin uses
  `st_mtimespec`/`st_ctimespec`; Linux uses `st_mtim`/`st_ctim`.
- `src/fovea/source-platform-native.ts`: typed low-level ABI and native adapter;
  `createNativeSourcePlatform` for the actual compiled host platform and
  `createNativeDarwinSourceBinding` for the Darwin contract. No loader/path/env
  lookup; factories are trusted-host code, not guest configuration.
- `tests/fovea/source-platform-native.test.ts`: compiles the actual addon with
  local headers, then tests native capture, permission/race boundaries,
  independent directory streams, read caps and descriptor lifecycle. Linux
  binaries identify themselves as Linux, never as a mocked Darwin native pass.

The engine still calls `captureSourceSnapshot` / `readScopeSafeFile`; these
select `sourcePlatform()` and cannot select a binding from guest arguments,
project rules, PATH, environment, or a repository-local native module.
The Darwin contract factory is deliberately **not** registered as an available
production backend. The future trusted loader belongs to the owner-approved
native/package change. No provenance-journal changes were needed for this
read-only adapter: its Linux-only transactional publication remains a separate
platform gate, not silently enabled by the source adapter.

## Preserved policy and acceptance ledger

| Boundary | Implementation / checked evidence |
| --- | --- |
| Repository-relative identity | Single-component opens from held parent handles; no absolute child names, slash, NUL, empty, dot or dot-dot components. Paths and content are not Unicode-normalized. Root must be canonical. |
| Ancestor races | Canonicality is only input validation. Open `/`, then every root component relative to the previous held descriptor. Enumeration and descendant opens use held handles after rename/unlink; no reopening the original path. Tests replace both root and nested directories at exact open boundaries. |
| Leaf no-follow | Linux uses `O_NOFOLLOW`; Darwin contract requires the same for every component, not only files. Leaf replacement with an outside symlink is rejected. |
| Permissions | Kernel credentials/ACLs decide read access. No chmod, elevated permission or alternate-path fallback. EACCES remains a source coverage gap / metadata error. Actual Linux mode-000 probes pass as a non-root user; these tests skip under root rather than claim denial. |
| Safe objects | Regular files only, link count exactly one before and after. Nonregular objects are not read; entry opens are nonblocking. Nested `.git` files/directories close the subtree; any marker error except ENOENT also closes it. |
| Exact byte binding | Hash the same Buffer written to private staging, including invalid UTF-8 contents. Aggregate ID remains SHA-256 of ordered `JSON.stringify([relativePath, sha256]) + '\n'` records. Existing traversal ordering and coverage shape are unchanged. |
| Concurrent file mutation | Before/after descriptor stats check size, mtime, ctime and nlink. Also verify actual read length, type, dev/ino, mode, uid and gid. Detected races never publish a file/hash. This is not an atomic multi-file filesystem snapshot; the binding is to precisely the captured bytes. |
| Exclusions / rule trust | Existing dependency, generated-source reporting, credential, host storage, unsupported-file and project-rule policies are shared unchanged. Only the independently approved `.fovea/rules.json` hash influences discovery, processed before other names. No sibling config adoption. |
| Private destination | Engine supplies a fresh host-owned `mkdtemp` stage. Newly created subdirectories request 0700 and files request 0400 with exclusive `wx`; existing files/links are not overwritten. Destination ancestry is trusted host storage, **not** made safe for arbitrary adversarial destinations by this source adapter. |
| Cleanup | File/directory handles close on failure and cancellation. Enumerator early return/throw closes its own stream, not the caller's directory. Abort is checked before/after reads and before publication; no successful snapshot is returned after abort. |

### Bounds

- At most 8,000 retained files, 8 MiB configurable per-file ceiling, 128 MiB
  retained snapshot bytes. Numeric options may tighten these budgets, not expand
  them or remove them using NaN/Infinity/fractions/negative values. Zero is valid.
- Existing content caps remain 1 MiB for ordinary source and 8 MiB for
  `.proto`/`.graphql`/`.gql`, further limited by `maxFileBytes`.
- Depth 0 through 64; directories below that are not enumerated. At most 50,000
  names retained per directory, 100,000 entries globally, plus one detection
  entry. Native prefetch is limited to 128 entries. Coverage retains at most
  20 example paths per reason; capping remains visible.
- Reads request at most 64 KiB, stopping at EOF or `cap + 1` bytes. Short reads
  fill the same working chunk; they do not retain one 64 KiB allocation per
  one-byte read. Chunk count and retained read memory are proportional to cap.
- Metadata uses the same reader, with a checked ceiling of 128 MiB; the current
  engine requests 1 MiB. Source file buffers are processed serially.
- `maxBytes` measures **retained snapshot bytes**, not total physical I/O over
  rejected/racing candidates. Physical source reads are bounded by candidate
  enumeration and the per-file cap-plus-one; this change does not mislabel the
  retained-byte budget as an aggregate disk-read budget.

## Implemented native contract: `DarwinSourceBinding` ABI 1

The implementation is an in-process N-API 8 addon, not a subprocess taking
arbitrary paths or inheriting guessed parent fds. Its C source compiles on Linux
and contains explicit Darwin branches; Darwin execution is not yet tested.
The TypeScript high-level contract is in `source-platform-darwin.ts`:

1. `abiVersion: 1`, `platform: 'darwin'`.
2. `openRootDirectory(): Promise<SourceHandle>` performs exactly
   `open("/", O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)`.
3. `openAt(parent, name, 'directory')` uses the held parent's fd and exactly one
   validated component, with `O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC`.
4. `openAt(parent, name, 'entry')` uses
   `O_RDONLY | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC`. Never create/write sources.
   The flags are symbolic contract requirements: map Darwin's actual values
   inside the binding, not Linux numeric constants from a fixture.
5. `SourceHandle.stat()` uses `fstat` and supplies the `SourceStat` subset of
   Node-compatible `Stats`: file type, dev/ino, nlink, size, mode, uid/gid and
   subsecond mtime/ctime in milliseconds (no truncation to whole seconds).
   Unsafe integer identities/sizes fail with EOVERFLOW rather than silently
   collapsing distinct inode values into an imprecise JS number.
6. `SourceHandle.read(buffer, offset, length, null)` uses the held descriptor
   and current offset. It writes only within the supplied range, returns
   `{ bytesRead }` in `0..length`, retries EINTR appropriately, preserves short
   reads, and reports EOF only as zero. No decoding or pathname reopen.
7. `SourceHandle.close()` invalidates the capability exactly once. Operations
   reject foreign/closed handles; asynchronous work pins ownership so fd-number
   reuse cannot turn an old handle into access to another object. The native
   layer owns all fds and does not expose an integer-fd borrowing loophole.
   Exactly one operation may be in flight per capability. Concurrent use,
   including close, rejects EBUSY (not an unbounded operation queue); wait for
   the original operation before closing. The TS wrapper permits retry after
   EBUSY and makes successfully completed close idempotent. Other close errors
   invalidate the capability; close is never blindly retried on EINTR, where a
   recycled descriptor could otherwise be closed. GC/environment finalizers
   close still-held capabilities; explicit await/finally remains the normal
   cleanup path.
8. `readDirectory(parent, 128)` returns an async iterable of exact entry names.
   Create an independent directory description using
   `openat(parentfd, ".", O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)`,
   then `fdopendir` / `readdir`. This literal native `"."` is internal, not an
   accepted caller component. Plain `dup` shares directory offsets and does
   not satisfy the independent-stream contract. Skip `.` and `..`, return
   no more than 128 names per native batch, never buffer a whole directory, and
   close the stream on EOF, iterator return, exceptions and cancellation cleanup.
   This bounds application-level prefetch; libc may keep its own bounded
   directory-read buffer (as it also does under Node's Linux opendir). It is
   not a claim that each kernel directory read contains at most 128 records.
   No `/dev/fd` or reconstructed full-path fallback. Preserve spelling and
   Unicode form; reject unrepresentable names rather than silently substitute
   a different path.
9. Preserve errno codes, especially ENOENT versus EACCES/ELOOP/ENOTDIR; apply
   ordinary process uid/gid/ACL permissions and bounded asynchronous I/O.
   Cancellation must not leak an in-flight opened fd or let a queued operation
   use a closed/recycled descriptor. There is no claim that JS abort interrupts
   an already-running kernel syscall; current checks prevent publication and
   close handles when it settles. Hard cancellation remains an engine-process
   lifecycle concern.

### Native implementation and fixture compilation

`PosixSourceBinding` is the low-level ABI exported by the C source:

- `abiVersion: 1`, actual compiled `platform: 'linux' | 'darwin'`.
- `openRoot()`, `openAt(parent, component, kind)`, `stat(handle)`,
  `read(handle, length)`, `close(handle)`.
- `openDirectory(parent)`, `readDirectory(stream)`, `closeDirectory(stream)`.

The returned capability objects are N-API type-tagged and wrapped, not fd
integers. Every operation other than root open requires such a capability;
wrong-kind, closed and forged objects fail EBADF. Worker-pool jobs hold a strong
reference until completion and copy native fd/DIR ownership into their job.
Capability state changes occur only on the JS thread. `read` accepts at most
65,536 bytes and returns a copied Buffer; no asynchronous job borrows a mutable
JS buffer pointer. Native reads additionally reject nonregular/hardlinked
objects. Directory batches contain at most 128 NAME_MAX-bounded UTF-8 names.
Lone UTF-16 surrogates, embedded NUL, slash, dot/dot-dot, overlong components and
invalid UTF-8 directory names fail closed rather than alias another path.
Each native job has a fixed bounded allocation; production policy performs
operations serially and retains its file/byte/entry/depth limits.

The native test compiles a temporary addon under `.tmp/source-platform-native-*`
using local Node headers (first the running Node's `../include/node`, then
system include directories) and removes it afterwards. Compiler/header failures
are explicit test prerequisite failures, not silently skipped native evidence.
The C flags are:

```text
-std=c11 -O2 -Wall -Wextra -Werror -fPIC -D_FILE_OFFSET_BITS=64
-I<local-node-headers>
# Linux:  -shared
# Darwin: -bundle -undefined dynamic_lookup
src/fovea/source-platform-native.c -o <private-fixture>/source-platform.node
```

No headers or binaries are downloaded. `cc` from PATH is a **test compiler**,
not runtime source authority. An initial standalone Linux compile and root /
stat / readdir / close probe also passed at
`.tmp/source-platform-native/source-platform.node`; this ignored fixture is
not a shipped artifact or a production loader input.

### Owner approval / residual gates

- Review the implemented ABI and every descriptor ownership/error path and
  syscall flag. TS ABI/platform checks are not binary authentication.
- Packaging proposal sent to owner: one fixed generation-local
  `fovea/native/source-platform.node`, with SHA-256, platform, architecture and
  N-API ABI recorded in the generation/closure manifest. The owner must decide
  and implement canonical/ownership/no-follow trusted loading from the verified
  installed generation, compatibility, supported Darwin architectures,
  reproducible native builds, certification/SBOM and release signing. No
  repository-local, arbitrary-path, environment-selected, unsigned downloaded
  or PATH helper. No shared build/packaging changes are made by this worker.
- Wire the verified binding into production `sourcePlatform()` only after these
  checks. Native binary loading is itself a security boundary.
- On a real macOS host, run native (not bridge) capture/metadata probes for
  root/nested/leaf swaps, no-follow, hardlinks, FIFO/device nonblocking behavior,
  ACL/EACCES, canonical `/private/...` roots, filesystem name/case behavior,
  byte/hash parity, budgets, short reads, cancellation and fd leaks.
- Qualify the separately Linux-only provenance writer before claiming full
  Fovea platform support. Source-read support does not authorize a race-prone
  path-based journal lock, rename or unlink fallback.
- Integration owner runs the fresh build, full check and installer suites
  serially and updates shared status/matrix/qualification documents. This
  worker does not change those files or claim their gates passed.

## Targeted evidence

Run directly with Vitest; do not use `pnpm test` / `test:built` for this scoped
worker because those invoke build/packaging work owned by the integrator.

```sh
pnpm exec vitest run tests/fovea/source-platform.test.ts tests/fovea/source-platform-bounds.test.ts
# 82 passed; 2 files; no skips on this Linux/non-root host.

pnpm exec vitest run tests/fovea/engine.test.ts tests/fovea/coverage-contract.test.ts \
  -t 'scope-safe exact source snapshots|validates real source counts'
# 4 passed; 10 unselected tests skipped.

pnpm exec vitest run tests/fovea/engine-review.test.ts \
  -t 'skips hardlinks, unsupported bytes and untrusted project rules before extraction'
# 1 passed; 10 unselected tests skipped.
```

After adding the actual native source and its typed bridge:

```sh
pnpm exec vitest run tests/fovea/source-platform-native.test.ts
# 27 passed on Linux, including real fixture compilation; no skips.
pnpm exec vitest run tests/fovea/source-platform.test.ts tests/fovea/source-platform-bounds.test.ts
# 82 passed after the shared SourceStat interface refinement; no skips.
```

The native cases cover matching exact hashes/coverage, modes, exclusions and
rules, file/byte budgets, root/nested/leaf/metadata ancestor swaps, actual EACCES,
FIFO nonblocking opens, invalid names/UTF-8, 64KiB read limits, 128-name batches,
independent directory offsets, EBUSY close races, fd reuse rejection, cleanup on
abort/early iteration/errors, and finalization when a Node worker terminates.
A no-emit TypeScript diagnostic probe restricted to the four owned TS source
files and three test files reported zero owned-file diagnostics. This is **not**
a whole-project typecheck. No full suite, production build, installer,
auth/live-home change, or commit was performed by this worker. Native Darwin
gates remain untested / environment-blocked; there is no native macOS pass count.
