import type { FabricArtifactAccess } from "../protocol.js";
import { createKiroArtifactStore, createKiroCheckpointStore, type KiroArtifactStore, type KiroArtifactStoreOptions } from "./artifacts.js";

/** One trusted host-session epoch, or one legacy MCP instance. Never workspace
 * identity or guest metadata. Stores are lazy, private and not imported from disk. */
export const createKiroArtifactOwner = (loadOptions: () => KiroArtifactStoreOptions) => {
  let options: KiroArtifactStoreOptions | undefined;
  let results: KiroArtifactStore | undefined;
  let checkpoints: KiroArtifactStore | undefined;
  let revoked = false;
  let closing: Promise<void> | undefined;
  const assertOpen = (): void => { if (revoked) throw new Error("artifact owner is retired"); };
  const settings = (): KiroArtifactStoreOptions => {
    assertOpen();
    options ??= { ...loadOptions() };
    // A trusted configuration callback may itself retire this owner.
    assertOpen();
    return options;
  };
  const unavailable = (): never => { throw new Error("artifact is unavailable or expired"); };
  const access: FabricArtifactAccess = Object.freeze({
    read(id: string, offset?: number, limit?: number) {
      assertOpen();
      if (checkpoints) {
        try { return checkpoints.read(id, offset, limit); }
        catch (error) {
          if (!(error instanceof Error) || !error.message.includes("unavailable or expired")) throw error;
        }
      }
      // An unknown handle grants neither store creation nor access to another
      // owner's file. There is no disk import or runtime-local fallback.
      return results ? results.read(id, offset, limit) : unavailable();
    },
    checkpoint(content: string): string {
      assertOpen();
      checkpoints ??= createKiroCheckpointStore(settings());
      return checkpoints.write(content);
    },
  });
  return {
    access,
    write(content: string, protectedIds?: readonly string[]): string {
      assertOpen();
      results ??= createKiroArtifactStore(settings());
      return results.write(content, protectedIds);
    },
    has(id: string): boolean {
      try {
        // A zero-data read checks expiry/ownership without renewing the idle TTL.
        access.read(id, Number.MAX_SAFE_INTEGER, 1);
        return true;
      } catch { return false; }
    },
    revoke(): void { revoked = true; },
    close(): Promise<void> {
      revoked = true;
      // Publish once before any storage callback; cleanup failures are sticky.
      return closing ??= Promise.resolve().then(() => {
        const failures: unknown[] = [];
        for (const store of [results, checkpoints]) {
          try { store?.close(); } catch (error) { failures.push(error); }
        }
        if (failures.length) throw new AggregateError(failures, "artifact owner cleanup failed");
      });
    },
  };
};
