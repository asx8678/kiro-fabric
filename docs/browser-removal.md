# Browser Harness removal

The bundled contained browser runtime and legacy external `browser-harness-js` web provider have been removed. The `browser` namespace, `web.search`, `web.open`, browser operator commands and bundled browser skill resources are no longer available. No replacement provider was added. Core non-browser execution, Navigator, local tools, configured MCP, storage and continuity remain in scope.

## Compatibility

- `web` and `browser` configuration sections (including disabled/empty values) reject explicitly. Remove only those sections, retaining approvals/privacy and unrelated configuration. Files are never rewritten by loading.
- The `restricted-web` mode is retained as a restrictive compatibility policy, not an available browser backend. Review found that the baseline documented generic restrictions but only implemented browser-specific approval checks. The execution bridge now explicitly refuses shell, probe execution and configured MCP paths (including aliases) before approval/dispatch. Standard-mode shell still works. This closes that compatibility gap; it is not OS/network confinement.
- New complete bundles use schema 2 (legacy non-parser schema 1 remains supported). Obsolete browser bundle schema 3 is rejected, including historical admission; existing generations/data are preserved for recovery rather than admitted unchecked. Legacy installer ownership schema 3 is a different format: authenticated shared-resource inventories and recovery evidence remain preserved, but no new browser resources are staged or attached to profiles.
- Obsolete generated Agent staging pointers/packages fail strict validation. Verification uses a fresh isolated staging root, leaving existing caches/pointers untouched; do not delete or bypass validation of an old cache to force an update.
- Installed applications, browser profiles, global skills and user data are not modified by this source change. Retired in-checkout files and pre-edit source are retained privately under `.tmp/browser-removal/`; do not blanket-delete that directory or upload its contents.
- “Stray.js” could not be identified in the repository/searchable history. No component was removed under that name; clarification is required before acting on it.

## Verification scope and known gaps

`pnpm run verify:offline runtime` contains six focused cases, run against a fresh build in retained private fixtures with no browser executable search path for the built-runtime probes. It checks removed exports/declarations/resources/globals, legacy configuration rejection without rewriting, discovery, local read/write/edit, memory/state/continuity persistence, approval denial, stale hashes, workspace boundaries and restrictive privacy behavior. `baseline` checks verifier controls; `installer` retains its existing I01–I09 contract and incomplete I07 coverage. None is release qualification or a substitute for the removed full suite.

`pnpm test`, `test:fast`, `test:built`, `check`, `prepack` and release-grade qualification remain deliberately fail-closed. Native Kiro/client approval UI, all-platform installer recovery, production signing and complete release qualification remain separate blocked gates. No real installation, authenticated client, browser, network or cluster verification is implied.

## Executed local checks

- Baseline before removal: typecheck, reference audit and dead-code lint passed.
- After removal: typecheck, guidance consistency, reference audit and dead-code lint passed. The first lint run identified a now-internal unused privacy type export; it was corrected, not suppressed.
- `node scripts/verify-offline.mjs runtime`: six cases passed. Initial NB03/NB04 fixture setup incorrectly removed ripgrep together with the browser CLI; corrected fixtures expose only ripgrep on PATH. Targeted NB04/NB06 reruns also prove standard-mode shell success and seven restricted direct/alias forms rejected before approval/dispatch.
- `PATH="$PWD/.tmp/trusted-node:$PATH" node scripts/verify-offline.mjs baseline installer`: baseline 8/8 passed; installer 8 passed, I07 partial; exit 1. I07's incomplete staging coverage is pre-existing, and its case file was preserved byte-for-byte.
- Fresh isolated Agent staging and package validation passed (105 files). The staged MCP component certifier passed initialization, provider inventory, checked execution, structured reads/search, declined approval, sandbox/compiler restrictions and bounded shutdown. Scope is **component MCP only**; authenticated Kiro was **NOT TESTED**.
- Synthetic package/profile/CLI contract probes passed schema-2 admission, obsolete schema-3 and browser-resource rejection, three profile modes, removed browser command/flags and the four retained release gates. This is not native installation/migration certification.
- `pnpm test` exited **69**, as intended for the already-deleted full suite. This is a blocker, not a passing suite.
- `pi-contour` reviewed the working tree; source witnesses were inspected alongside the task-only baseline delta. Its structural coverage is incomplete and includes large pre-existing changes; zero policy findings does not certify correctness. Unrelated existing cleanup/verifier findings were not rewritten for a score.
- Mechanical preservation check found zero unexpected baseline-file changes, preserved 263 pre-existing test deletions, and confirmed unchanged Git staging. All generated outputs were rebuilt through the supported generators; prior output and fixture repositories were retained.

Detailed local logs, change inventory and isolated-package receipt are under `.tmp/browser-removal/`. No full-suite, production-release, real installed-agent or cross-platform qualification is claimed. Finish any subsequent source edit with `pnpm run build` before using `dist/`.

## Retained historical references

`docs/browser-*.md` implementation/repair plans (other than this current note) are marked historical and retained because they also record unrelated verifier and cleanup work. Their old paths, commands and evidence claims are not current features. `AGENTS.md` is unchanged: its owner safety rules remain authoritative, even where its allowed-web section names an integration no longer shipped here. Negative compatibility checks and regression cases may name removed providers. Generic browser-authentication suppression in native Kiro probes is unrelated and remains.
