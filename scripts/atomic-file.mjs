import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const writeFileAtomic = (target, bytes, options = {}) => {
  const output = path.resolve(target);
  fs.mkdirSync(path.dirname(output), { recursive: true, mode: 0o700 });
  const temporary = path.join(path.dirname(output), `.${path.basename(output)}.${process.pid}.${randomBytes(12).toString("hex")}.tmp`);
  let descriptor;
  try {
    descriptor = fs.openSync(temporary, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0), options.mode ?? 0o600);
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor); descriptor = undefined;
    fs.renameSync(temporary, output);
    const directory = fs.openSync(path.dirname(output), "r");
    try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
  } catch (error) {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    fs.rmSync(temporary, { force: true });
    throw error;
  }
  return output;
};
