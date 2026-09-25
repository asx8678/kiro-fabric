#!/usr/bin/env node
import { FoveaEngine } from './engine.js';
import { decodeRequest, encodeFrame, projectEngineJson, type FoveaResponse } from './protocol.js';

let engine: FoveaEngine | undefined;
let current: { id: string; controller: AbortController } | undefined;
let closing: Promise<void> | undefined;
const seen = new Set<string>();
const safeError = (error: unknown): string => (error instanceof Error ? error.message : 'Navigator engine failure').replace(/[\u0000-\u001f\u007f]/gu, ' ').slice(0, 800);
const send = (response: FoveaResponse): void => { if (!closing && process.connected) process.send?.(encodeFrame(response)); };
const sendFinal = async (response: FoveaResponse): Promise<void> => {
  if (!process.connected || !process.send) return;
  await new Promise<void>((resolve, reject) => { process.send!(encodeFrame(response), error => error ? reject(error) : resolve()); });
};
const shutdown = (id?: string, protocolError?: unknown): Promise<void> => {
  if (closing) return closing;
  closing = Promise.resolve().then(async () => {
    let failure = protocolError;
    try { await engine?.close(); } catch (error) { failure = error; }
    try {
      if (id) await sendFinal(failure === undefined
        ? { version: 1, id, ok: true, value: { shutdown: true, closed: true, cleanup: { scratch: 'removed' } } }
        : { version: 1, id, ok: false, error: safeError(failure) });
    } catch (error) { failure ??= error; }
    // Ack flush and process exit are distinct observations. The parent still
    // confirms the entire process group within its unchanged cleanup budget.
    process.exit(failure === undefined ? 0 : 1);
  }).catch(() => { process.exit(1); });
  current?.controller.abort(new Error('Navigator engine shutdown'));
  return closing;
};
process.once('disconnect', () => { void shutdown(); });
process.once('SIGTERM', () => { void shutdown(); });
process.on('message', raw => {
  void (async () => {
    const message = decodeRequest(raw);
    if (message.type === 'cancel') { if (message.id === current?.id) current.controller.abort(new Error('Navigator request cancelled')); return; }
    if (message.type === 'shutdown') { await shutdown(message.id); return; }
    if (closing || seen.has(message.id) || current) throw new Error('Navigator replay or concurrent request rejected');
    seen.add(message.id); if (seen.size > 1024) seen.delete(seen.values().next().value!);
    if (message.type === 'initialize') {
      if (engine) throw new Error('Navigator already initialized');
      engine = new FoveaEngine(message.options);
      send({ version: 1, id: message.id, ok: true, value: { initialized: true, ipcVersion: 1 } }); return;
    }
    if (!engine) throw new Error('Navigator not initialized');
    if (message.type === 'retireConversation') {
      current = { id: message.id, controller: new AbortController() };
      try { await engine.retireConversation(message.conversationId, message.conversationEpoch); send({ version: 1, id: message.id, ok: true, value: { retired: true } }); }
      finally { current = undefined; }
      return;
    }
    const controller = new AbortController(); current = { id: message.id, controller };
    const timer = setTimeout(() => controller.abort(new Error('Navigator worker deadline expired')), message.remainingMs);
    try {
      const value = projectEngineJson(await engine.query(message.request, controller.signal));
      controller.signal.throwIfAborted();
      send({ version: 1, id: message.id, ok: true, value });
    } catch (error) { send({ version: 1, id: message.id, ok: false, error: safeError(error) }); }
    finally { clearTimeout(timer); current = undefined; }
  })().catch(error => { void shutdown(undefined, error); });
});
