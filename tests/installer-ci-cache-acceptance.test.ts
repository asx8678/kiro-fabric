import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { fixtureTools } from "./bundle-fixture.js";
import { rematerializeInstallerToolCache } from "../scripts/installer-ci-cache.mjs";
import { verifyPrivateToolCache } from "../scripts/build-private-tools.mjs";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
const fixture = () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "installer-ci-cache-"))); roots.push(root); fs.chmodSync(root, 0o700);
  const source = path.join(root, "transport"), destination = path.join(root, "private-tools"), target = "linux-x64", pins = fixtureTools(target);
  fs.mkdirSync(source, { mode: 0o700 });
  for (const pin of Object.values(pins)) for (const member of pin.members) {
    fs.mkdirSync(path.dirname(path.join(source, member.path)), { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(source, member.path), `fixture ${member.path}`, { mode: member.path.startsWith("tools/") ? 0o700 : 0o600 });
  }
  return { root, source, destination, pins, target };
};
describe("verified CI tool cache transport", () => {
  it("recreates bytes under fresh current-owner single-link identities and existing hash checks", async () => {
    const f = fixture(); await rematerializeInstallerToolCache(f);
    await verifyPrivateToolCache(f.destination, f.pins, f.target);
    for (const pin of Object.values(f.pins)) for (const member of pin.members) {
      const old = fs.statSync(path.join(f.source, member.path)), fresh = fs.statSync(path.join(f.destination, member.path));
      expect(fresh.ino).not.toBe(old.ino); expect(fresh.uid).toBe(process.getuid?.()); expect(fresh.nlink).toBe(1);
      expect(fresh.mode & 0o777).toBe(member.path.startsWith("tools/") ? 0o700 : 0o600);
    }
    expect(fs.readdirSync(f.destination).sort()).toEqual(["notices", "tools"]);
  });
  it.each(["hash", "symlink", "hardlink", "extra file", "extra directory", "receipt", "writable", "size"])("rejects %s without publishing or altering restored evidence", async fault => {
    const f = fixture(), file = path.join(f.source, "tools/node");
    if (fault === "hash") fs.writeFileSync(file, "x".repeat(fs.statSync(file).size));
    if (fault === "symlink") { fs.renameSync(file, path.join(f.root, "external")); fs.symlinkSync(path.join(f.root, "external"), file); }
    if (fault === "hardlink") fs.linkSync(file, path.join(f.root, "external"));
    if (fault === "extra file") fs.writeFileSync(path.join(f.source, "extra"), "keep");
    if (fault === "extra directory") fs.mkdirSync(path.join(f.source, "extra"));
    if (fault === "receipt") fs.writeFileSync(path.join(f.source, "receipt.json"), "untrusted inode identities");
    if (fault === "writable") fs.chmodSync(file, 0o777);
    if (fault === "size") fs.appendFileSync(file, "extra");
    const before = fs.readFileSync(file);
    await expect(rematerializeInstallerToolCache(f)).rejects.toThrow();
    expect(fs.existsSync(f.destination)).toBe(false); expect(fs.readFileSync(file)).toEqual(before);
    expect(fs.readdirSync(f.root).some(name => name.startsWith(".installer-cache-import-"))).toBe(false);
  });
  it("never overwrites an existing destination or trusts a changed target pin", async () => {
    const f = fixture(); fs.mkdirSync(f.destination); fs.writeFileSync(path.join(f.destination, "keep"), "user bytes");
    await expect(rematerializeInstallerToolCache(f)).rejects.toThrow(/exists/); expect(fs.readFileSync(path.join(f.destination, "keep"), "utf8")).toBe("user bytes");
    await expect(rematerializeInstallerToolCache({ ...f, target: "darwin-arm64" })).rejects.toThrow();
  });
});
