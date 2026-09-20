# Strict pre-identity-change installer fixtures

These three unmodified source blobs come from commit
`020d86c37178ab17453d9a03ec6e60318fcda243` (`scripts/*.mjs`).
`tests/installer-directory-identity.test.ts` verifies their SHA-256 hashes before
relocating only static relative imports into a private temporary fixture.

The tests execute the actual archived manager, profile snapshot reader and
transaction reader. They establish unchanged owner-field compatibility **and**
the older manager's fail-closed refusal of schema-2 sidecars. They also generate
real schema-1 records to exercise ambiguous device mismatches in the new reader.
Unchanged owner schema is not a claim of full old-manager compatibility.
