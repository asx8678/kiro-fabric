// Native host adaptation of pi-fovea b5944838. No ambient engine state.
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Stats } from 'node:fs';
export interface CoreContext {
  store: Map<string, unknown>;
  sessionStore: Map<string, unknown>;
  parserPath: string;
  storageRoot: string;
  signal: AbortSignal;
  gitPath?: string | undefined;
  sourceRoot: string;
  snapshotRoot: string;
  gitFailures: string[];
  focusKey: string;
  spills: Map<string, string>;
  readGitMetadata?: ((path: string) => Promise<string>) | undefined;
  artifactLabel?: ((operation: string, key: string) => string) | undefined;
  cleanupTemporary?: ((file: string, snapshot: Stats, available: () => boolean) => Promise<boolean>) | undefined;
  displayName?: string | undefined;
  toolName?: ((operation: string) => string) | undefined;
}
export const coreContext = new AsyncLocalStorage<CoreContext>();
// Direct-core callers retain upstream labels; the host supplies its public names.
export const coreDisplayName = (fallback = 'fovea'): string => coreContext.getStore()?.displayName ?? fallback;
export const coreToolName = (operation: string): string => coreContext.getStore()?.toolName?.(operation) ?? `fovea_${operation}`;
export function context(): CoreContext {
  const value = coreContext.getStore();
  if (!value) throw new Error('Navigator core requires an explicit engine context');
  return value;
}
export const privateTmpdir = (): string => context().storageRoot;
export function owned<T extends object>(key: string, create: () => T, session = false): T {
  return new Proxy({} as T, {
    get(_target, property) {
      const store = session ? context().sessionStore : context().store;
      let value = store.get(key) as T | undefined;
      if (!value) { value = create(); store.set(key, value); }
      const member: unknown = Reflect.get(value, property, value);
      return typeof member === 'function' ? member.bind(value) : member;
    },
    set(_target, property, next) {
      const store = session ? context().sessionStore : context().store;
      let value = store.get(key) as T | undefined;
      if (!value) { value = create(); store.set(key, value); }
      return Reflect.set(value, property, next, value);
    },
  });
}
export const safeEnvironment = (): NodeJS.ProcessEnv => ({
  LANG: 'C', LC_ALL: 'C', HOME: context().storageRoot, TMPDIR: context().storageRoot,
  GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_OPTIONAL_LOCKS: '0',
  GIT_NO_LAZY_FETCH: '1', GIT_ALLOW_PROTOCOL: '', GIT_TERMINAL_PROMPT: '0',
  GIT_ATTR_NOSYSTEM: '1',
});
