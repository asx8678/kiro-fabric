#!/usr/bin/env node
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { constants as zlibConstants, gzipSync } from "node:zlib";
import { writeFileAtomic } from "./atomic-file.mjs";
import { validateAgentPackage } from "./validate-agent-package.mjs";

const TAR_BLOCK_BYTES = 512;
const TAR_NAME_BYTES = 100;
const TAR_PREFIX_BYTES = 155;
const TAR_CHECKSUM_OFFSET = 148;
const TAR_CHECKSUM_BYTES = 8;
const MAX_ARCHIVE_BYTES = 80 * 1024 * 1024;
const EMPTY_BLOCK = Buffer.alloc(TAR_BLOCK_BYTES);

const writeText = (header, offset, length, value, label) => {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.length > length) throw new Error(`${label} exceeds the USTAR field bound`);
  bytes.copy(header, offset);
};

const writeOctal = (header, offset, length, value, label) => {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a non-negative safe integer`);
  const digits = value.toString(8);
  if (digits.length > length - 1) throw new Error(`${label} exceeds the USTAR numeric field bound`);
  header.write(`${digits.padStart(length - 1, "0")}\0`, offset, length, "ascii");
};

const splitUstarPath = (relative) => {
  if (!relative || relative.includes("\0") || path.posix.isAbsolute(relative) || relative.split("/").includes("..")) {
    throw new Error(`Unsafe archive path: ${JSON.stringify(relative)}`);
  }
  if (Buffer.byteLength(relative, "utf8") <= TAR_NAME_BYTES) return { name: relative, prefix: "" };
  let separator = relative.length;
  while ((separator = relative.lastIndexOf("/", separator - 1)) > 0) {
    const prefix = relative.slice(0, separator);
    const name = relative.slice(separator + 1);
    if (Buffer.byteLength(prefix, "utf8") <= TAR_PREFIX_BYTES && Buffer.byteLength(name, "utf8") <= TAR_NAME_BYTES) {
      return { name, prefix };
    }
  }
  throw new Error(`Archive path exceeds the USTAR path bound: ${relative}`);
};

const tarHeader = ({ relative, directory, size, modifiedAt }) => {
  const header = Buffer.alloc(TAR_BLOCK_BYTES);
  const { name, prefix } = splitUstarPath(relative);
  writeText(header, 0, TAR_NAME_BYTES, name, "archive name");
  writeOctal(header, 100, 8, directory ? 0o700 : 0o600, "archive mode");
  writeOctal(header, 108, 8, 0, "archive uid");
  writeOctal(header, 116, 8, 0, "archive gid");
  writeOctal(header, 124, 12, directory ? 0 : size, "archive size");
  writeOctal(header, 136, 12, modifiedAt, "archive timestamp");
  header.fill(0x20, TAR_CHECKSUM_OFFSET, TAR_CHECKSUM_OFFSET + TAR_CHECKSUM_BYTES);
  header[156] = directory ? 0x35 : 0x30;
  writeText(header, 257, 6, "ustar\0", "USTAR magic");
  writeText(header, 263, 2, "00", "USTAR version");
  writeOctal(header, 329, 8, 0, "archive device major");
  writeOctal(header, 337, 8, 0, "archive device minor");
  writeText(header, 345, TAR_PREFIX_BYTES, prefix, "archive prefix");
  let checksum = 0;
  for (const byte of header) checksum += byte;
  const checksumText = checksum.toString(8);
  if (checksumText.length > 6) throw new Error("USTAR checksum exceeds its field bound");
  header.write(checksumText.padStart(6, "0"), TAR_CHECKSUM_OFFSET, 6, "ascii");
  header[TAR_CHECKSUM_OFFSET + 6] = 0;
  header[TAR_CHECKSUM_OFFSET + 7] = 0x20;
  return header;
};

const collectEntries = (root) => {
  const records = [];
  const visit = (directory) => {
    const entries = fs.readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => Buffer.compare(Buffer.from(left.name, "utf8"), Buffer.from(right.name, "utf8")));
    for (const entry of entries) {
      const target = path.join(directory, entry.name);
      const relative = path.relative(root, target).replaceAll(path.sep, "/");
      const stats = fs.lstatSync(target);
      if (stats.isSymbolicLink()) throw new Error(`Archive source contains a symlink: ${relative}`);
      if (stats.isDirectory()) {
        records.push({ relative, directory: true, size: 0, content: undefined });
        visit(target);
      } else if (stats.isFile()) {
        if (stats.nlink !== 1) throw new Error(`Archive source contains a hard-linked file: ${relative}`);
        const content = fs.readFileSync(target);
        if (content.length !== stats.size) throw new Error(`Archive source changed while reading: ${relative}`);
        records.push({ relative, directory: false, size: content.length, content });
      } else {
        throw new Error(`Archive source contains an unsupported entry: ${relative}`);
      }
    }
  };
  visit(root);
  return records.sort((left, right) => Buffer.compare(Buffer.from(left.relative, "utf8"), Buffer.from(right.relative, "utf8")));
};

const pathContains = (root, target) => {
  const relative = path.relative(root, target);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
};

const sourceDateEpoch = (value) => {
  const text = String(value ?? process.env.SOURCE_DATE_EPOCH ?? "0");
  if (!/^(?:0|[1-9][0-9]*)$/u.test(text)) throw new Error("SOURCE_DATE_EPOCH must be a non-negative integer");
  const parsed = Number(text);
  if (!Number.isSafeInteger(parsed)) throw new Error("SOURCE_DATE_EPOCH exceeds the safe integer range");
  return parsed;
};

/**
 * @param {string} packageInput
 * @param {string} outputInput
 * @param {{ sourceDateEpoch?: string | number }} [options]
 */
export const createAgentArchive = (packageInput, outputInput, options = {}) => {
  const modifiedAt = sourceDateEpoch(options.sourceDateEpoch);
  const requestedRoot = path.resolve(packageInput);
  const output = path.resolve(outputInput);
  const evidence = validateAgentPackage(requestedRoot);
  if (pathContains(requestedRoot, output) || pathContains(evidence.root, output)) {
    throw new Error("Agent archive output must be outside the staged package");
  }
  const entries = collectEntries(evidence.root);
  const verified = validateAgentPackage(evidence.root);
  if (verified.digest !== evidence.digest || verified.files !== evidence.files || verified.bytes !== evidence.bytes) {
    throw new Error("Agent package changed during archive creation");
  }
  const chunks = [];
  for (const entry of entries) {
    chunks.push(tarHeader({ ...entry, modifiedAt }));
    if (entry.content) {
      chunks.push(entry.content);
      const remainder = entry.content.length % TAR_BLOCK_BYTES;
      if (remainder !== 0) chunks.push(Buffer.alloc(TAR_BLOCK_BYTES - remainder));
    }
  }
  chunks.push(EMPTY_BLOCK, EMPTY_BLOCK);
  const tarBytes = Buffer.concat(chunks);
  const bytes = gzipSync(tarBytes, { level: zlibConstants.Z_BEST_COMPRESSION });
  if (bytes.length > MAX_ARCHIVE_BYTES) throw new Error("Agent archive exceeds 80 MiB");
  const digest = createHash("sha256").update(bytes).digest("hex");
  writeFileAtomic(output, bytes);
  return { output, digest, bytes: bytes.length, packageDigest: evidence.digest };
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const valueAfter = (flag) => { const index = process.argv.indexOf(flag); return index >= 0 ? process.argv[index + 1] : undefined; };
  const result = createAgentArchive(
    valueAfter("--package") ?? ".tmp/kiro-fabric-agent",
    valueAfter("--output") ?? ".tmp/kiro-fabric-agent.tar.gz",
  );
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
