import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { ActorManager } from "../src/actors/manager.js";
import { CapturedToolCatalog } from "../src/capture/catalog.js";
import { normalizeFabricConfig } from "../src/config.js";
import { FabricRuntimeState } from "../src/fabric-runtime-state.js";
import { LifecycleBroker } from "../src/lifecycle/broker.js";
import { ResidencyClient } from "../src/residency/client.js";
import {
  FABRIC_COMPONENT_DISCOVER_EVENT,
  FABRIC_PROVIDER_DISCOVER_EVENT,
  type FabricComponentDiscovery,
} from "../src/protocol.js";

describe("Fabric runtime provider components", () => {
  it("activates every enabled built-in component before execution and discovery", async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "kiro-fabric-runtime-components-"));
    fs.mkdirSync(path.join(cwd, ".pi"), { recursive: true });
    vi.stubEnv("PI_CODING_AGENT_DIR", path.join(cwd, "agent"));
    vi.stubEnv("KIRO_FABRIC_PROJECT_ROOT", cwd);

    let runtime!: FabricRuntimeState;
    const discoverySnapshots: Array<{ initialized: boolean; active: string[] }> = [];
    let componentDiscovery: FabricComponentDiscovery | undefined;
    const pi = {
      events: {
        emit: vi.fn((event: string, payload: unknown) => {
          if (event === FABRIC_COMPONENT_DISCOVER_EVENT) {
            componentDiscovery = payload as FabricComponentDiscovery;
            componentDiscovery.register({
              name: "guidance-only",
              guarantee: "revertible",
              activate(component) {
                component.guide({
                  label: "deepseek-profile",
                  models: ["deepseek/*"],
                  content: "Use the DeepSeek profile.",
                });
              },
            });
          }
          if (event === FABRIC_PROVIDER_DISCOVER_EVENT) {
            discoverySnapshots.push({
              initialized: runtime.initialized,
              active: runtime.componentGraph().components
                .filter((component) => component.state === "active")
                .map((component) => component.id)
                .sort(),
            });
          }
        }),
      },
      getThinkingLevel: vi.fn(() => "off"),
      sendMessage: vi.fn(),
    } as unknown as ExtensionAPI;
    const context = {
      cwd,
      hasUI: false,
      isProjectTrusted: () => true,
      isIdle: () => true,
      hasPendingMessages: () => false,
      modelRegistry: {
        find: vi.fn(),
        getApiKeyAndHeaders: vi.fn(),
      },
      sessionManager: {
        getSessionId: () => "runtime-components-session",
        getSessionFile: () => undefined,
        getBranch: () => [],
        getLeafId: () => undefined,
      },
      ui: {
        setStatus: vi.fn(),
        notify: vi.fn(),
      },
    } as unknown as ExtensionContext;
    const config = normalizeFabricConfig({
      fullCodeMode: true,
      capture: { enabled: true },
      components: [{ id: "guidance-only", component: "guidance-only" }],
      mcp: { enabled: false, cache: { enabled: false } },
      mesh: { enabled: true },
      memory: { enabled: true },
      agents: { enabled: false },
      residency: { enabled: false },
      prewalk: { enabled: false, alwaysRearm: false },
    });
    const fixture = path.join(cwd, "unused.mjs");
    fs.writeFileSync(fixture, "export default {};");
    runtime = new FabricRuntimeState(pi, new CapturedToolCatalog(), undefined, undefined, {
      paths: {
        extension: fixture,
        worker: fixture,
        residentHost: fixture,
        skills: cwd,
      },
    });

    try {
      await runtime.initialize(context, config);

      expect(discoverySnapshots).toEqual([{
        initialized: true,
        active: [
          "fabric.provider.agents",
          "fabric.provider.compact",
          "fabric.provider.evidence",
          "fabric.provider.extensions",
          "fabric.provider.mcp",
          "fabric.provider.memory",
          "fabric.provider.mesh",
          "fabric.provider.pi",
          "fabric.provider.schema",
          "fabric.provider.state",
        ],
      }]);
      const discovery = componentDiscovery;
      if (!discovery) throw new Error("Expected component discovery");
      expect(() => discovery.register({
        name: "fabric.provider.mcp",
        activate() {},
      }, { overwrite: true })).toThrow(
        "Reserved Fabric component name: fabric.provider.mcp",
      );
      const builtins = runtime.componentGraph().components.filter((component) =>
        component.id.startsWith("fabric.provider.")
      );
      expect(builtins).toEqual(
        expect.arrayContaining([
          ...[
            "pi",
            "extensions",
            "mcp",
            "mesh",
            "state",
            "schema",
            "compact",
            "agents",
            "memory",
          ].map((name) => expect.objectContaining({
            id: `fabric.provider.${name}`,
            state: "active",
          })),
        ]),
      );
      expect(builtins.flatMap((component) =>
        component.effects?.flatMap((effect) => effect.resources) ?? []
      )).not.toContain("*");
      expect(builtins.find((component) => component.id === "fabric.provider.mcp")?.effects).toEqual([{
        label: "provider-component:mcp:holder",
        kind: "transactional",
        resources: ["fabric:provider:mcp:holder"],
        ordering: "ordered",
      }]);

      const guidance = runtime.componentGraph().components.find((component) =>
        component.id === "guidance-only"
      );
      expect(guidance).toMatchObject({ state: "active" });
      expect(guidance?.effectConflicts).toBeUndefined();
      expect(runtime.modelGuidance()).toContainEqual(
        expect.objectContaining({
          componentId: "guidance-only",
          label: "deepseek-profile",
        }),
      );
    } finally {
      await runtime.shutdown();
      vi.unstubAllEnvs();
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("validates inherited commitment before actors, lifecycle, residency, or user components start", async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "kiro-fabric-runtime-ordering-"));
    fs.mkdirSync(path.join(cwd, ".pi"), { recursive: true });
    vi.stubEnv("PI_CODING_AGENT_DIR", path.join(cwd, "agent"));
    vi.stubEnv("KIRO_FABRIC_PROJECT_ROOT", cwd);
    vi.stubEnv("KIRO_FABRIC_CAPABILITY_REQUIREMENTS", "[]");
    vi.stubEnv("KIRO_FABRIC_CAPABILITY_DIGEST", "f".repeat(64));
    const actorStart = vi.spyOn(ActorManager.prototype, "start");
    const lifecycleStart = vi.spyOn(LifecycleBroker.prototype, "start");
    const residencyStart = vi.spyOn(ResidencyClient.prototype, "start");
    let componentDiscoverySeen = false;
    let componentActivated = false;
    const pi = {
      events: {
        emit: vi.fn((event: string, payload: unknown) => {
          if (event !== FABRIC_COMPONENT_DISCOVER_EVENT) return;
          componentDiscoverySeen = true;
          (payload as FabricComponentDiscovery).register({
            name: "must-not-activate",
            guarantee: "revertible",
            activate() {
              componentActivated = true;
            },
          });
        }),
      },
      getThinkingLevel: vi.fn(() => "off"),
      sendMessage: vi.fn(),
    } as unknown as ExtensionAPI;
    const context = {
      cwd,
      hasUI: false,
      isProjectTrusted: () => true,
      isIdle: () => true,
      hasPendingMessages: () => false,
      modelRegistry: {
        find: vi.fn(),
        getApiKeyAndHeaders: vi.fn(),
      },
      sessionManager: {
        getSessionId: () => "runtime-ordering-session",
        getSessionFile: () => undefined,
        getBranch: () => [],
        getLeafId: () => undefined,
      },
      ui: {
        setStatus: vi.fn(),
        notify: vi.fn(),
      },
    } as unknown as ExtensionContext;
    const config = normalizeFabricConfig({
      fullCodeMode: true,
      capture: { enabled: true },
      components: [{ id: "must-not-activate", component: "must-not-activate" }],
      mcp: { enabled: false, cache: { enabled: false } },
      mesh: { enabled: true },
      memory: { enabled: false },
      agents: { enabled: false },
      prewalk: { enabled: false, alwaysRearm: false },
    });
    const fixture = path.join(cwd, "unused.mjs");
    fs.writeFileSync(fixture, "export default {};");
    const runtime = new FabricRuntimeState(pi, new CapturedToolCatalog(), undefined, undefined, {
      paths: {
        extension: fixture,
        worker: fixture,
        residentHost: fixture,
        skills: cwd,
      },
    });

    try {
      await expect(runtime.initialize(context, config)).rejects.toThrow(
        "Fabric capability commitment mismatch",
      );
      expect(actorStart).not.toHaveBeenCalled();
      expect(lifecycleStart).not.toHaveBeenCalled();
      expect(residencyStart).not.toHaveBeenCalled();
      expect(componentDiscoverySeen).toBe(false);
      expect(componentActivated).toBe(false);
    } finally {
      await runtime.shutdown();
      vi.restoreAllMocks();
      vi.unstubAllEnvs();
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });
});
