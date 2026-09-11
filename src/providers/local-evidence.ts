import type { LocalEvidenceMetadata, LocalReadEvidenceResult, LocalReadManyResult } from "./local-contract.js";

/** Pure formatting of a read result, not a reader or inspection ledger.
 * This helper does not validate snapshots; the provider verifies before return.
 * The final line is always `META <JSON>`; JSON escapes embedded newlines in paths.
 * Source offsets/lengths address the decoded string in UTF-16 code units, so even
 * source text resembling a footer cannot change packet framing. Full-file hashes
 * identify original bytes, not the numbered/CRLF-normalized source presentation.
 * Callers must budget JSON.stringify(packet).length, not packet.length. */
export function formatLocalEvidence(result: LocalReadManyResult): LocalReadEvidenceResult {
  let packet = "KIRO_LOCAL_EVIDENCE/1\n";
  const files: LocalEvidenceMetadata["files"] = [];
  const hashes = new Map(result.files.map(file => [file.path, file.sha256]));
  for (const [index, file] of result.files.entries()) {
    const { source, ...metadata } = file;
    packet += `SOURCE ${index} ${JSON.stringify(file.path)}\n`;
    files.push({ ...metadata, sourceOffset: packet.length, sourceChars: source.length });
    packet += source + "\n";
  }
  const metadata: LocalEvidenceMetadata = {
    scope: "requested windows only; not proof of inspection",
    files,
    // Also bind later, not-yet-delivered windows of a delivered file. Retrying
    // failed requests preserves explicit expected hashes; it never blesses drift.
    remaining: result.remaining.map(window => {
      const sha256 = window.expectedSha256 ?? hashes.get(window.path);
      return { ...window, ...(sha256 === undefined ? {} : { expectedSha256: sha256 }) };
    }),
    complete: result.complete,
    unreadTails: result.unreadTails,
    failures: result.failures ?? [],
  };
  return packet + `META ${JSON.stringify(metadata)}`;
}
