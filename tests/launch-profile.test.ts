import { removeFixtureSync } from "./fixture-cleanup.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { prepareLaunchProfile } from "../scripts/launch-profile.mjs";
import { parseManagerArguments } from "../scripts/install-manager.mjs";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) removeFixtureSync(root, { recursive: true, force: true }); });
function fixture() {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "fabric-launch-profile-"))); roots.push(home);
  fs.mkdirSync(path.join(home, "agents"), { mode: 0o700 });
  const original = path.join(home, "agents/kiro-fabric.json"); fs.writeFileSync(original, "managed default", { mode: 0o600 });
  return { home, original, installation: { status: "active", owner: { currentRuntime: "a".repeat(64) } } };
}
describe("explicit launch guidance modes", () => {
  it("accepts only an explicit valid start mode", () => {
    expect(parseManagerArguments(["start", "--guidance-mode", "review"]).guidanceMode).toBe("review");
    for (const args of [["start", "--guidance-mode", "guess"], ["update", "--guidance-mode", "review"], ["--guidance-mode", "review"]]) expect(() => parseManagerArguments(args)).toThrow();
  });
  it("does not write for the standard default", () => {
    const f = fixture(); expect(prepareLaunchProfile(f.home, f.installation)).toMatchObject({ name: "kiro-fabric", created: false });
    expect(fs.readdirSync(path.join(f.home, "agents"))).toEqual(["kiro-fabric.json"]);
  });
  it.each(["review", "minimal"] as const)("creates and reuses a retained %s profile without changing default", mode => {
    const f = fixture(); const first = prepareLaunchProfile(f.home, f.installation, mode);
    const profile = JSON.parse(fs.readFileSync(first.path!, "utf8"));
    expect(profile.name).toBe(first.name); expect(profile.tools).toEqual(["@fabric/fabric_exec"]);
    expect(profile.includePowers).toBe(false); expect(profile.includeMcpJson).toBe(false);
    if (mode === "minimal") { expect(profile.resources).toEqual([]); expect(profile.hooks).toEqual([]); }
    else { expect(profile.resources.length).toBeGreaterThan(0); expect(profile.hooks.length).toBeGreaterThan(0); }
    expect(prepareLaunchProfile(f.home, f.installation, mode).created).toBe(false);
    expect(fs.readFileSync(f.original, "utf8")).toBe("managed default");
    fs.appendFileSync(first.path!, "modified");
    expect(() => prepareLaunchProfile(f.home, f.installation, mode)).toThrow(/different content/);
    expect(fs.readFileSync(first.path!, "utf8")).toContain("modified");
  });
  it("refuses symlink targets and unverified state", () => {
    const f = fixture(); const name = "kiro-fabric-review-" + "a".repeat(12);
    fs.symlinkSync(f.original, path.join(f.home, "agents", `${name}.json`));
    expect(() => prepareLaunchProfile(f.home, f.installation, "review")).toThrow();
    expect(() => prepareLaunchProfile(f.home, { ...f.installation, status: "retired" }, "minimal")).toThrow();
    expect(fs.readFileSync(f.original, "utf8")).toBe("managed default");
  });
});
