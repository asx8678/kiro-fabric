# Installer/updater acceptance ledger

Implementation in progress. Extend the existing complete-generation installer rather than create a competing installation format.

- [x] Automatically back up existing selected Kiro-home configuration before Fabric installation or agent registration changes; backup failures prevent activation.
- [x] Keep backups private, uniquely named, durable and outside the copied tree; do not follow unsafe links or silently omit configuration. Explain backup scope and restore procedure.
- [x] Preserve unrelated settings, authentication, sessions and agent profiles; retain existing ownership/conflict and transaction recovery protections.
- [x] Installation defaults to global `~/.kiro`, with existing explicit `--kiro-home` / `KIRO_HOME` precedence.
- [x] Register `agents/kiro-fabric.json` using existing exact-generation profile and executable launcher.
- [x] Source install/update commands work explicitly; signed public distribution stays blocked until the real trust root and release qualification exist.
- [x] Test first install, update, backup contents/order/failure, unsafe paths and permissions, and registration with disposable homes only.
- [x] Verify Linux/macOS portability without claiming native execution on an unavailable platform.
- [x] Update user documentation and run targeted tests/direct probes, typechecking as appropriate, and a final fresh `pnpm run build`.

Initial trace: `install.sh` -> `scripts/source-install.mjs` -> `scripts/install-manager.mjs` -> `scripts/managed-installation.mjs` -> transaction activation. The existing managed transaction protects selected control files, not a durable backup of all pre-existing Kiro configuration. Installed release update intentionally fails closed while the production signing trust root is absent. See `docs/installer.md` for current contracts.
