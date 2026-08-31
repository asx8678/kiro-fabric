import { isFabricAgentRunner } from "./agents/runners.js";
import {
  assertSafeConfigDocument,
  isConfigObject,
  safeConfigClone,
  safeConfigMerge,
} from "./config-object.js";

export const CURRENT_FABRIC_CONFIG_VERSION = 4;

export interface FabricConfigMigrationResult {
  document: Record<string, unknown>;
  fromVersion: number;
  toVersion: number;
  appliedVersions: number[];
  changed: boolean;
  forwardCompatible?: boolean;
}

interface FabricConfigMigration {
  from: number;
  to: number;
  migrate(document: Readonly<Record<string, unknown>>): Record<string, unknown>;
}

const isObject = isConfigObject;

const migrations: readonly FabricConfigMigration[] = [
  {
    from: 0,
    to: 1,
    migrate(document) {
      const migrated = safeConfigClone(document) as Record<string, unknown>;
      const legacy = migrated.subagents;
      const canonical = migrated.agents;
      if (legacy !== undefined) {
        if (canonical !== undefined && isObject(legacy) !== isObject(canonical)) {
          throw new Error(
            "Fabric configuration cannot merge legacy subagents with a malformed agents section",
          );
        }
        migrated.agents = isObject(legacy) && isObject(canonical)
          ? safeConfigMerge(legacy, canonical)
          : canonical ?? legacy;
      }
      delete migrated.subagents;
      return migrated;
    },
  },
  {
    from: 1,
    to: 2,
    migrate(document) {
      const migrated = safeConfigClone(document) as Record<string, unknown>;
      const ui = migrated.ui;
      if (isObject(ui) && Object.hasOwn(ui, "showNestedToolCalls")) {
        const renamed = safeConfigClone(ui) as Record<string, unknown>;
        if (!Object.hasOwn(renamed, "showAgentToolPreview")) {
          renamed.showAgentToolPreview = renamed.showNestedToolCalls;
        }
        delete renamed.showNestedToolCalls;
        migrated.ui = renamed;
      }
      return migrated;
    },
  },
  {
    from: 2,
    to: 3,
    migrate(document) {
      const migrated = safeConfigClone(document) as Record<string, unknown>;
      const ui = migrated.ui;
      if (isObject(ui) && Object.hasOwn(ui, "nestedToolDebounceMs")) {
        const renamed = safeConfigClone(ui) as Record<string, unknown>;
        if (!Object.hasOwn(renamed, "updateDebounceMs")) {
          renamed.updateDebounceMs = renamed.nestedToolDebounceMs;
        }
        delete renamed.nestedToolDebounceMs;
        migrated.ui = renamed;
      }
      return migrated;
    },
  },
  {
    from: 3,
    to: 4,
    migrate(document) {
      return safeConfigClone(document) as Record<string, unknown>;
    },
  },
];

const assertSupportedConfigRunners = (document: Readonly<Record<string, unknown>>): void => {
  const agents = document.agents;
  if (!isObject(agents) || !Object.hasOwn(agents, "runner")) return;
  if (!isFabricAgentRunner(agents.runner)) {
    throw new Error(`Unsupported Fabric agent runner: ${String(agents.runner)}`);
  }
};

const configVersion = (document: Readonly<Record<string, unknown>>): number => {
  const value = document.configVersion;
  if (value === undefined) return 0;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error("Fabric configuration configVersion must be a non-negative integer");
  }
  return value;
};

export const migrateFabricConfigDocument = (
  input: Readonly<Record<string, unknown>>,
): FabricConfigMigrationResult => {
  assertSafeConfigDocument(input);
  const fromVersion = configVersion(input);
  let version = fromVersion;
  let document = safeConfigClone(input) as Record<string, unknown>;
  const appliedVersions: number[] = [];

  if (fromVersion > CURRENT_FABRIC_CONFIG_VERSION) {
    return {
      document,
      fromVersion,
      toVersion: fromVersion,
      appliedVersions,
      changed: false,
      forwardCompatible: true,
    };
  }

  while (version < CURRENT_FABRIC_CONFIG_VERSION) {
    const migration = migrations.find((candidate) => candidate.from === version);
    if (!migration || migration.to !== version + 1) {
      throw new Error(`No Fabric configuration migration exists for version ${version}`);
    }
    document = migration.migrate(document);
    version = migration.to;
    document.configVersion = version;
    appliedVersions.push(version);
  }

  if (Object.hasOwn(document, "subagents")) {
    throw new Error("Current Fabric configuration contains removed key subagents");
  }

  assertSupportedConfigRunners(document);

  return {
    document,
    fromVersion,
    toVersion: version,
    appliedVersions,
    changed: appliedVersions.length > 0,
  };
};
