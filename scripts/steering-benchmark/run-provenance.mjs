import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { reviewHelpDelivery } from './review-delivery.mjs';
import { analyzeEvents } from './stream.mjs';

// Node >=24 runs this pure TypeScript source directly; no build/dist mutation.
/** @type {typeof import('../../src/kiro/run-provenance.js')} */
const { buildRunProvenance, RUN_PROVENANCE_LIMITS } = await import(new URL('../../src/kiro/run-provenance.ts', import.meta.url).href);
const MAX_FILE_BYTES = RUN_PROVENANCE_LIMITS.contentBytes;
const MAX_TOTAL_BYTES = 16 * MAX_FILE_BYTES;
const MAX_EVENTS = 4096;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {};

/** Explicit descriptor-selected files only. No profile expansion, Git, ambient env,
 * directory walks, runtime loading or agent execution. Errors omit paths/content. */
export function captureRunProvenance(descriptorFile) {
  let remaining = MAX_TOTAL_BYTES;
  function read(filename) {
    if (typeof filename !== 'string' || !filename.length || filename.length > 4096) throw new Error('Invalid selected file');
    // Reject final symlinks and special files; open nonblocking to avoid FIFO races.
    const fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    try {
      const stat = fs.fstatSync(fd);
      if (!stat.isFile() || stat.size > MAX_FILE_BYTES || stat.size > remaining) throw new Error('Selected file limit');
      const buffer = Buffer.alloc(Math.min(MAX_FILE_BYTES, remaining) + 1);
      let length = 0;
      while (length < buffer.length) {
        const count = fs.readSync(fd, buffer, length, buffer.length - length, null);
        if (!count) break;
        length += count;
      }
      if (length > MAX_FILE_BYTES || length > remaining) throw new Error('Selected file limit');
      remaining -= length;
      return buffer.subarray(0, length);
    } finally { fs.closeSync(fd); }
  }
  const descriptorBytes = read(descriptorFile);
  const descriptor = JSON.parse(descriptorBytes.toString('utf8'));
  if (descriptor === null || typeof descriptor !== 'object' || Array.isArray(descriptor)) throw new Error('Invalid descriptor');
  const root = path.dirname(path.resolve(descriptorFile));
  const selected = filename => filename === undefined ? undefined : read(path.resolve(root, filename));
  const entries = filenames => {
    if (filenames === undefined) return undefined;
    if (!Array.isArray(filenames) || filenames.length > RUN_PROVENANCE_LIMITS.entries) throw new Error('Selected file count limit');
    return filenames.map(filename => ({ content: selected(filename) }));
  };
  const repo = object(descriptor.repository);
  const commit = selected(repo.commitFile)?.toString('utf8').trim();
  const resources = entries(descriptor.resourceFiles), hooks = entries(descriptor.hookFiles);
  const manifest = buildRunProvenance({ configured: {
    guidanceMode: descriptor.guidanceMode, requestedModel: descriptor.requestedModel, requestedEffort: descriptor.requestedEffort,
    profile: selected(descriptor.profileFile), runtimeBundle: selected(descriptor.bundleFile), prompt: selected(descriptor.promptFile),
    ...(resources === undefined ? {} : { resources }), ...(hooks === undefined ? {} : { hooks }),
    repository: { commit, dirty: repo.dirty, dirtyEvidence: selected(repo.dirtyEvidenceFile) },
  } });
  const referenceBytes = selected(descriptor.reviewReferenceFile);
  const reference = referenceBytes?.toString('utf8');
  const eventBytes = selected(descriptor.eventsFile);
  let evidence;
  if (eventBytes !== undefined) {
    const lines = eventBytes.toString('utf8').split('\n').filter(line => line.trim());
    if (lines.length > MAX_EVENTS) throw new Error('Event count limit');
    // Raw ACP JSONL, not a user-supplied delivery summary or normalized loaded flag.
    evidence = analyzeEvents(lines.map(line => JSON.parse(line)));
  }
  const delivery = reviewHelpDelivery(evidence, reference);
  const output = {
    schemaVersion: 1,
    evidence: 'caller-selected-files-not-runtime-attestation',
    manifest,
    reviewHelpDelivery: {
      ...delivery,
      reference: buildRunProvenance({ configured: { prompt: referenceBytes } }).configured.prompt,
      eventEvidence: buildRunProvenance({ configured: { prompt: eventBytes } }).configured.prompt,
    },
  };
  return output;
}

/** Comparison says only whether supplied evidence matches; equal unknowns are NOT equivalence. */
export function compareRunProvenance(left, right) {
  const l = captureRunProvenance(left), r = captureRunProvenance(right);
  const paths = [
    ['configured', 'guidanceMode'], ['configured', 'profile'], ['configured', 'requestedModel'], ['configured', 'requestedEffort'],
    ['configured', 'runtimeBundle'], ['configured', 'prompt'], ['configured', 'resources'], ['configured', 'hooks'],
    ['configured', 'repository'], ['observed', 'runtimeBundle'], ['observed', 'guidanceDelivery'], ['observed', 'routing'],
  ];
  const known = value => {
    if (value === null || value === undefined) return false;
    if (typeof value !== 'object') return true;
    if ('commit' in value) return value.commit !== null && value.dirty !== null && value.dirtyEvidence?.status === 'known';
    return value.status === 'known' || value.status === 'observed-content-match';
  };
  const comparisons = paths.map(([section, key]) => {
    const a = l.manifest[section][key], b = r.manifest[section][key];
    return { field: `${section}.${key}`, status: !known(a) || !known(b) ? 'unknown' : JSON.stringify(a) === JSON.stringify(b) ? 'same' : 'different' };
  });
  return { schemaVersion: 1, interpretation: 'content-evidence-only-not-semantic-or-routing-equivalence', left: l, right: r, comparisons };
}

/** @param {string[]} args */
export function runProvenanceCli(args) {
  if (args.length === 3 && args[0] === 'manifest' && args[1] === '--input') return captureRunProvenance(args[2]);
  if (args.length === 5 && args[0] === 'compare' && args[1] === '--left' && args[3] === '--right') return compareRunProvenance(args[2], args[4]);
  throw new Error('Usage: run-provenance.mjs manifest --input FILE | compare --left FILE --right FILE');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(runProvenanceCli(process.argv.slice(2)), null, 2)); }
  catch { console.error('Run provenance failed: check explicit descriptors, evidence format and file bounds.'); process.exitCode = 1; }
}
