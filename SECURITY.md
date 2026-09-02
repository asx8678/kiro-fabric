# Security policy

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. Use GitHub's private
**Security advisories → Report a vulnerability** flow for this repository. If
that flow is unavailable, contact the repository owner through the contact
listed on the GitHub profile and request a private reporting channel. Include
affected versions, impact, reproduction steps, and any proposed mitigation.

The maintainer will acknowledge a report as soon as practical, coordinate
validation and remediation privately, and credit reporters who want attribution.
Please do not disclose the issue until a fixed release is available.

## Supported versions

Kiro Fabric has not yet published its first immutable supported release. The
current source checkout is pre-release software and receives best-effort
security fixes on `main`; it is not covered by a published-version support
promise. Do not treat a mutable branch or local Power import as a signed
release. When the first release satisfies the documented qualification,
signature, SBOM, checksum, and attestation gates, this section will name the
supported release line explicitly. See
[`docs/kiro/release-governance.md`](docs/kiro/release-governance.md).
