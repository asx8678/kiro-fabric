import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { Value } from "typebox/value";
import {
  FABRIC_EXEC_RESULT_FORMATS,
  fabricExecInputSchema,
  fabricExecInputSchemaJson,
  prepareFabricExecArguments,
} from "../src/kernel/fabric-exec-contract.js";
import { createFabricExecTool } from "../src/fabric-exec-tool.js";

// Golden contract for the host-neutral fabric_exec input schema. Every host
// adapter (Pi today, Kiro MCP next) must consume this exact object; the test
// pins property order, anyOf/const representation, descriptions, and the
// deliberate absence of additionalProperties:false.

const publicJson = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

const EXPECTED_SCHEMA = {
  type: "object",
  properties: {
    code: {
      type: "string",
      description:
        "TypeScript function body. Top-level await and return are supported. Globals are capability-sensitive: managed Kiro provides `k`, `tools`, `print`, and `π`, plus `mcp`, `memory`, or `agents` only when enabled. Unavailable namespaces are omitted and fail closed; other host adapters may expose additional globals. See the host's `fabric-exec` skill for exact signatures.",
    },
    strings: {
      type: "object",
      patternProperties: { "^.*$": { type: "string" } },
      description:
        "Named strings exposed as π.key, useful for content that is awkward to quote",
    },
    resultFormat: {
      anyOf: [
        { const: "auto", type: "string" },
        { const: "yaml", type: "string" },
        { const: "json", type: "string" },
        { const: "text", type: "string" },
      ],
    },
    tokenBudget: {
      type: "number",
      minimum: 1,
      description: "Optional token budget for hosts that expose usage-accounted workflow agents; unmetered Kiro ACP children do not consume it",
    },
    agentBudget: {
      type: "number",
      minimum: 1,
      description: "Optional agent-call cap, bounded by host capabilities and Fabric configuration",
    },
    display: {
      anyOf: [
        {
          type: "object",
          properties: {
            name: {
              type: "string",
              description:
                "Concise execution milestone used by the Fabric activity UI and deterministic compaction continuity",
            },
            description: {
              type: "string",
              description:
                "Compact declared objective or acceptance criterion shown in the dashboard and richer compaction activity",
            },
          },
        },
        {
          type: "string",
          description:
            "Objective shorthand normalized to { name } (a JSON-object string is parsed). Prefer the object form when available.",
        },
      ],
    },
  },
  required: ["code"],
};

describe("fabric_exec kernel contract", () => {
  it("matches the golden public JSON Schema exactly", () => {
    expect(fabricExecInputSchemaJson()).toEqual(EXPECTED_SCHEMA);
    expect(publicJson(fabricExecInputSchema)).toEqual(EXPECTED_SCHEMA);
    expect(FABRIC_EXEC_RESULT_FORMATS).toEqual(["auto", "yaml", "json", "text"]);
  });

  it("is the schema consumed by the Pi tool adapter", () => {
    const state = {
      bootstrapped: false,
      config: { ui: { toolDisplay: "full" } },
    };
    const tool = createFabricExecTool(state as never, {} as never, new Map(), (t) => t);
    expect(publicJson(tool.parameters)).toEqual(EXPECTED_SCHEMA);
  });

  it("keeps root and display objects open for forward compatibility", () => {
    expect(Value.Check(fabricExecInputSchema, {
      code: "return 1;",
      futureKey: { anything: true },
    })).toBe(true);
    expect(Value.Check(fabricExecInputSchema, {
      code: "return 1;",
      display: { name: "x", unknownExtra: 1 },
    })).toBe(true);
  });

  it("requires only code and applies numeric minima", () => {
    expect(Value.Check(fabricExecInputSchema, { code: "return 1;" })).toBe(true);
    expect(Value.Check(fabricExecInputSchema, {})).toBe(false);
    expect(Value.Check(fabricExecInputSchema, { code: "x", tokenBudget: 0 })).toBe(false);
    expect(Value.Check(fabricExecInputSchema, { code: "x", agentBudget: 1.5 })).toBe(true);
    expect(Value.Check(fabricExecInputSchema, {
      code: "x",
      resultFormat: "yaml",
    })).toBe(true);
    expect(Value.Check(fabricExecInputSchema, {
      code: "x",
      resultFormat: "markdown",
    })).toBe(false);
  });

  it("shares prepareFabricExecArguments across hosts", () => {
    expect(prepareFabricExecArguments("return 1;")).toEqual({ code: "return 1;" });
    expect(prepareFabricExecArguments({ code: "return 1;", display: "Probe" })).toEqual({
      code: "return 1;",
      display: { name: "Probe" },
    });
  });

  it("never imports a host package from the kernel source closure", () => {
    const kernelDir = resolve("src/kernel");
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (full.endsWith(".ts")) files.push(full);
      }
    };
    walk(kernelDir);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      const imports = source.match(/^\s*(?:import|export)[^;]*from\s+["'][^"']+["']/gm) ?? [];
      for (const statement of imports) {
        expect(statement, `${file} must stay host-neutral`).not.toMatch(
          /@earendil-works\/|@mariozechner\/pi-|pi-coding-agent|pi-tui|pi-ai/,
        );
      }
    }
  });
});
