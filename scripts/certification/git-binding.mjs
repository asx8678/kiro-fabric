import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const GIT_BINDING_KIND = "kiro-fabric.git-binding";
export const GIT_BINDING_SCHEMA_VERSION = 1;

const git = (root, args, encoding) => execFileSync("git", args, {
  cwd: root,
  encoding,
  stdio: ["ignore", "pipe", "ignore"],
});

const hashField = (hash, label, value) => {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value));
  hash.update(`${label}\0${bytes.length}\0`);
  hash.update(bytes);
  hash.update("\0");
};

const workspaceTreeHash = (root, head) => {
  const listed = git(root, ["ls-files", "--cached", "--others", "--exclude-standard", "-z"]);
  const relativePaths = listed
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .sort((left, right) => Buffer.from(left).compare(Buffer.from(right)));
  const hash = createHash("sha256");
  hashField(hash, "format", "kiro-fabric-workspace-tree-v1");
  hashField(hash, "head", head);

  for (const relative of relativePaths) {
    const absolute = path.resolve(root, relative);
    const prefix = `${path.resolve(root)}${path.sep}`;
    if (!absolute.startsWith(prefix)) throw new Error(`Git returned a path outside the checkout: ${relative}`);

    hashField(hash, "path", relative.split(path.sep).join("/"));
    let stat;
    try {
      stat = fs.lstatSync(absolute);
    } catch (error) {
      if (error && typeof error === "object" && error.code === "ENOENT") {
        hashField(hash, "type", "missing");
        continue;
      }
      throw error;
    }

    if (stat.isSymbolicLink()) {
      hashField(hash, "type", "symlink");
      hashField(hash, "target", fs.readlinkSync(absolute));
    } else if (stat.isFile()) {
      hashField(hash, "type", "file");
      hashField(hash, "executable", (stat.mode & 0o111) === 0 ? "0" : "1");
      hashField(hash, "contents", fs.readFileSync(absolute));
    } else {
      // Gitlinks are directories in the worktree. Their committed identity is
      // already part of HEAD; the status bit below captures local submodule drift.
      hashField(hash, "type", stat.isDirectory() ? "gitlink" : "other");
    }
  }

  return hash.digest("hex");
};

export const captureGitBinding = (root) => {
  const head = git(root, ["rev-parse", "--verify", "HEAD"], "utf8").trim();
  if (!/^[a-f0-9]{40,64}$/.test(head)) throw new Error("Git returned an invalid HEAD object id");
  const status = git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  return {
    kind: GIT_BINDING_KIND,
    schemaVersion: GIT_BINDING_SCHEMA_VERSION,
    head,
    treeHash: workspaceTreeHash(root, head),
    dirty: status.length > 0,
  };
};

export const tryCaptureGitBinding = (root) => {
  try {
    return captureGitBinding(root);
  } catch {
    return undefined;
  }
};

export const validateGitBinding = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return value.kind === GIT_BINDING_KIND
    && value.schemaVersion === GIT_BINDING_SCHEMA_VERSION
    && typeof value.head === "string"
    && /^[a-f0-9]{40,64}$/.test(value.head)
    && typeof value.treeHash === "string"
    && /^[a-f0-9]{64}$/.test(value.treeHash)
    && typeof value.dirty === "boolean";
};

export const gitBindingsMatch = (left, right) => validateGitBinding(left)
  && validateGitBinding(right)
  && left.head === right.head
  && left.treeHash === right.treeHash
  && left.dirty === right.dirty;
