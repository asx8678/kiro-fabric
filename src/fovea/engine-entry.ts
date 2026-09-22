#!/usr/bin/env node
import { FoveaEngine } from "./engine.js";
import { decodeRequest, encodeFrame, projectEngineJson, type FoveaResponse } from "./protocol.js";

let engine: FoveaEngine | undefined;
let current: { id: string; controller: AbortController } | undefined;
let closing = false;
const seen = new Set<string>();
const send = (response: FoveaResponse): void => { if (process.connected) process.send?.(encodeFrame(response)); };
const safeError = (error: unknown): string => (error instanceof Error ? error.message : "Fovea engine failure").replace(/[\u0000-\u001f\u007f]/gu, " ").slice(0, 800);
const shutdown = async (): Promise<void> => { if (closing) return; closing = true; current?.controller.abort(); await engine?.close(); process.exit(0); };
process.once("disconnect", () => { void shutdown(); });
process.once("SIGTERM", () => { void shutdown(); });
process.on("message", raw => {
  void (async () => {
    const message = decodeRequest(raw);
    if (message.type === "cancel") { if (message.id === current?.id) current.controller.abort(new Error("Fovea request cancelled")); return; }
    if (message.type === "shutdown") { await shutdown(); return; }
    if (closing || seen.has(message.id) || current) throw new Error("Fovea replay or concurrent request rejected");
    seen.add(message.id); if (seen.size > 1024) seen.delete(seen.values().next().value!);
    if (message.type === "initialize") {
      if (engine) throw new Error("Fovea already initialized");
      engine = new FoveaEngine(message.options);
      send({ version: 1, id: message.id, ok: true, value: { initialized: true, ipcVersion: 1 } }); return;
    }
    if (!engine) throw new Error("Fovea not initialized");
    if (message.type === "retireConversation") {
      current = { id: message.id, controller: new AbortController() };
      try {
        await engine.retireConversation(message.conversationId, message.conversationEpoch);
        send({ version: 1, id: message.id, ok: true, value: { retired: true } });
      } finally { current = undefined; }
      return;
    }
    const controller = new AbortController(); current = { id: message.id, controller };
    const timer = setTimeout(() => controller.abort(new Error("Fovea worker deadline expired")), message.remainingMs);
    try {
      const value = projectEngineJson(await engine.query(message.request, controller.signal));
      controller.signal.throwIfAborted();
      send({ version: 1, id: message.id, ok: true, value });
    } catch (error) { send({ version: 1, id: message.id, ok: false, error: safeError(error) }); }
    finally { clearTimeout(timer); current = undefined; }
  })().catch(() => { void shutdown(); });
});
