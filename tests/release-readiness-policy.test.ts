import fs from "node:fs";
import { parse as parseYaml } from "yaml";
import { describe, expect, it } from "vitest";
import { PROCESS_LIFECYCLE_TEST_FILES } from "../vitest.test-groups.js";

interface WorkflowJob {
  "timeout-minutes"?: number;
  steps?: Array<{ uses?: string; run?: string; with?: Record<string, unknown> }>;
  strategy?: { matrix?: { os?: string[] } };
}

const workflow = (file: string): { jobs: Record<string, WorkflowJob> } =>
  parseYaml(fs.readFileSync(file, "utf8")) as { jobs: Record<string, WorkflowJob> };

describe("release-readiness automation policy", () => {
  it("bounds every CI/release job and pins every external action by commit", () => {
    for (const file of [
      ".github/workflows/ci.yml",
      ".github/workflows/kiro-power-real.yml",
      ".github/workflows/release.yml",
      ".github/workflows/release-candidate.yml",
    ]) {
      const parsed = workflow(file);
      for (const [name, job] of Object.entries(parsed.jobs)) {
        expect(job["timeout-minutes"], `${file}:${name}`).toEqual(expect.any(Number));
        expect(job["timeout-minutes"], `${file}:${name}`).toBeGreaterThan(0);
        for (const step of job.steps ?? []) {
          if (!step.uses || step.uses.startsWith("./")) continue;
          expect(step.uses, `${file}:${name}`).toMatch(/^[^@]+@[0-9a-f]{40}$/u);
        }
      }
    }
  });

  it("provisions exact Go in every workflow job that runs native-fixture tests", () => {
    for (const [file, jobName] of [
      [".github/workflows/ci.yml", "check"],
      [".github/workflows/release.yml", "release"],
      [".github/workflows/release-candidate.yml", "report"],
    ] as const) {
      const job = workflow(file).jobs[jobName]!;
      const setup = job.steps?.find((step) => step.uses?.startsWith("actions/setup-go@"));
      expect(setup, `${file}:${jobName}`).toBeDefined();
      expect(setup?.with).toMatchObject({ "go-version": "1.25.1", cache: false });
    }
  });

  it("keeps process owners serial and repeats Linux/macOS lifecycle clusters", () => {
    expect(PROCESS_LIFECYCLE_TEST_FILES).toContain("tests/agentless-benchmark.test.ts");
    expect(PROCESS_LIFECYCLE_TEST_FILES).toContain("tests/kiro-process-lifecycle.test.ts");
    expect(PROCESS_LIFECYCLE_TEST_FILES).toContain("tests/kiro-dev-agent-process.test.ts");
    const stress = workflow(".github/workflows/ci.yml").jobs["lifecycle-stress"]!;
    expect(stress.strategy?.matrix?.os).toEqual(["ubuntu-latest", "macos-latest"]);
    expect(stress.steps?.some((step) => step.run === "pnpm run test:lifecycle:stress")).toBe(true);
  });

  it("keeps release-candidate evidence non-publishing", () => {
    const content = fs.readFileSync(".github/workflows/release-candidate.yml", "utf8");
    expect(content).toContain("scripts/release-candidate-report.mjs");
    expect(content).toContain("kiro-power-real-qualification.json");
    expect(content).toContain("generate-power-sbom.mjs");
    expect(content).not.toMatch(/gh release create|npm publish|git push/iu);
  });
});
