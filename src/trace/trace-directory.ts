import fs from "node:fs";
import path from "node:path";

export const validateTraceDirectory = (directory: string, dataRoot = directory, create = false): string => {
  if (!path.isAbsolute(directory) || !path.isAbsolute(dataRoot)) throw new Error("trace directory and data root must be absolute paths");
  const root = path.resolve(dataRoot), target = path.resolve(directory);
  const relative = path.relative(root, target);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error("trace directory escapes the data root");
  const inspect = (current: string, privateDirectory = true): void => {
    let stats: fs.Stats;
    try { stats = fs.lstatSync(current); }
    catch (error) {
      if (!create || (error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      inspect(path.dirname(current), false);
      try { fs.mkdirSync(current, { mode: 0o700 }); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
      stats = fs.lstatSync(current);
    }
    if (!stats.isDirectory() || stats.isSymbolicLink() || fs.realpathSync(current) !== current ||
        (privateDirectory && process.platform !== "win32" && ((stats.mode & 0o077) !== 0 ||
          (typeof process.getuid === "function" && stats.uid !== process.getuid())))) {
      throw new Error(`trace directory must be canonical, private, owned, and free of symlinks: ${current}`);
    }
  };
  inspect(root);
  let current = root;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    inspect(current);
  }
  return target;
};
