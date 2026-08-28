import { describe, expect, it } from "vitest";
import {
  KIRO_MODEL_LIST_ARGUMENTS,
  listKiroModels,
  parseKiroModelList,
  resetKiroModelInventoryCache,
} from "../src/kiro/model-inventory.js";

const SAMPLE = `Available models (* = default):

* auto                 1.00x credits      Models chosen by task for optimal usage and consistent quality
  claude-opus-4.5      2.20x credits      Claude Opus 4.5 model
  claude-sonnet-4.5    1.30x credits      Claude Sonnet 4.5 model
  claude-haiku-4.5     0.40x credits      The latest Claude Haiku model
  qwen3-coder-next     0.05x credits      Experimental preview of Qwen3 Coder Next
  gpt-5.6-sol          2.40x credits      Experimental preview of OpenAI GPT 5.6 Sol with 272k context window
`;

describe("Kiro model inventory", () => {
  it("probes the v3 engine through the machine-readable list format", () => {
    expect(KIRO_MODEL_LIST_ARGUMENTS).toEqual([
      "chat",
      "--v3",
      "--list-models",
      "--format",
      "json",
    ]);
  });

  it("parses v3 JSON model inventories", () => {
    expect(parseKiroModelList(JSON.stringify({
      models: [
        { modelId: "auto", name: "Automatic", isDefault: true },
        { modelId: "gpt-5.6-terra", name: "GPT 5.6 Terra", creditMultiplier: 1 },
      ],
    }))).toEqual([
      {
        runner: "kiro",
        provider: "kiro",
        id: "auto",
        name: "auto — Automatic",
        key: "kiro/auto",
        isDefault: true,
      },
      {
        runner: "kiro",
        provider: "kiro",
        id: "gpt-5.6-terra",
        name: "gpt-5.6-terra — GPT 5.6 Terra",
        key: "kiro/gpt-5.6-terra",
        creditMultiplier: 1,
        isDefault: false,
      },
    ]);
  });

  it("parses the snake_case JSON emitted by Kiro CLI 2.20.1", () => {
    expect(parseKiroModelList(JSON.stringify({
      models: [
        {
          model_name: "Automatic",
          model_id: "auto",
          context_window_tokens: 200_000,
        },
      ],
      default_model: "auto",
    }))).toEqual([{
      runner: "kiro",
      provider: "kiro",
      id: "auto",
      name: "auto — Automatic",
      key: "kiro/auto",
      isDefault: true,
    }]);
  });

  it("parses kiro-cli chat --list-models output into structured entries", () => {
    const entries = parseKiroModelList(SAMPLE);
    const ids = entries.map((entry) => entry.id);
    const routed = new Set([
      "claude-haiku-4.5",
      "qwen3-coder-next",
      "claude-opus-4.5",
    ]);
    expect(ids).toEqual(expect.arrayContaining([
      "auto",
      "claude-haiku-4.5",
      "qwen3-coder-next",
      "claude-opus-4.5",
      "claude-sonnet-4.5",
      "gpt-5.6-sol",
    ]));
    for (const id of routed) {
      const entry = entries.find((e) => e.id === id)!;
      expect(entry.runner).toBe("kiro");
      expect(entry.provider).toBe("kiro");
      expect(entry.key).toBe(`kiro/${id}`);
      expect(entry.name).toContain(id);
    }
    expect(entries.find((e) => e.id === "auto")?.isDefault).toBe(true);
    expect(entries.find((e) => e.id === "claude-haiku-4.5")?.isDefault).toBe(false);
    expect(entries.find((e) => e.id === "claude-opus-4.5")?.creditMultiplier).toBe(2.2);
  });

  it("keeps parsing the legacy plain format as a compatibility fallback", () => {
    expect(parseKiroModelList(`Available models (* = default):\n* auto ----- credits\n`))
      .toEqual([{
        runner: "kiro",
        provider: "kiro",
        id: "auto",
        name: "auto",
        key: "kiro/auto",
        isDefault: true,
      }]);
  });

  it("falls back to the always-supported auto model when the binary probe fails", async () => {
    resetKiroModelInventoryCache();
    // The binary does not exist, so the probe errors and we retain a usable inventory.
    const first = await listKiroModels("definitely-not-a-real-kiro-cli", false);
    expect(first.map((entry) => entry.id)).toEqual(["auto"]);
    // A second call must reuse the cached result without a second probe.
    const second = await listKiroModels("definitely-not-a-real-kiro-cli", false);
    expect(second).toEqual(first);
  });
});
