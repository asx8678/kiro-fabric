# W5 portable pre-W5 entrypoint fixture

`install-agent-user.pre-w5.mjs.txt` is the **exact, byte-unchanged** pre-W5
`scripts/install-agent-user.mjs` source. It is stored as maintained text (`.mjs.txt`)
so `tsconfig.scripts.json` does not compile it as a live module; its relative
historical imports are intentionally rewritten by the verification loader.

- sha256: `43c1932d604a66117d26cba1fbfd5e11eed0b7891e58a300b04df720730fdc6b`
- bytes: 55741
- provenance: reconstructed by the W5 review from the repository state *before*
  the W5 locking bridge patch. The byte-identical capture is recorded as
  `.tmp/w5-w7-KFgyWY/astra-w5-before-install-agent-user.mjs` and in the W5
  before-state manifest `.tmp/w5-w7-KFgyWY/before.json` under the key
  `scripts/install-agent-user.mjs` with the same sha256. The capture was
  hash-confirmed against that manifest before this fixture was written, and the
  fixture was confirmed byte-identical (`cmp`) to the capture.

This fixture is the immutable *authentic legacy writer* used by the W5 caller
regressions (LK17-LK19). It deliberately is **not** the user-deleted Vitest
suite and it does **not** restore any removed test.

## Loader-only seams (bytes are never edited on disk)

`scripts/verification/w5-callers-legacy.mjs` loads these bytes and applies two
documented, harness-only transformations in memory:

1. **Relative-import rewire (resolution only).** Historical `./x.mjs` sibling
   imports are rewritten to absolute URLs under the repository `scripts/`
   directory so the historical source resolves the current standalone helpers.
   No import is added or removed.
2. **Inert executable-trust boundary.** Exactly one line,
   `const nodePath = assertTrustedExecutable(fs.realpathSync(process.execPath));`,
   is replaced so the legacy writer can run under a harness Node whose ancestry
   is not trusted (for example Homebrew). Lock, ownership and exclusion
   behaviour are unchanged, and no executable is launched.

Both seams are called out at the loader and in the maintaining case's
`effects` string. The pinned digest is verified on every load; a mismatch fails
closed.
