import { FabricError } from "../errors.js";
import type { FabricLiteApi } from "../../types/fabric-lite.js";
import { networkRequest } from "../permissions.js";
import { safePath } from "./paths.js";
import { command, type CommandResult } from "./command.js";
import type { ApiContext } from "./context.js";

export function createInspectApi(ctx: ApiContext): FabricLiteApi["inspect"] {
  const { config, root, gate } = ctx;
  const inspectionResult = (tool: string, operation: string, result: CommandResult) => {
    if (result.code !== 0)
      throw new FabricError(
        "RUNTIME_FAILED",
        result.stderr.trim() || `${tool} ${operation} failed`,
      );
    return {
      tool,
      operation,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.code,
      truncated: result.stdoutTruncated || result.stderrTruncated,
    };
  };
  const safeToken = (
    value: string | undefined,
    label: string,
    pattern = /^[A-Za-z0-9._\/:@-]+$/,
  ): string | undefined => {
    if (value === undefined) return undefined;
    if (value.startsWith("-") || !pattern.test(value))
      throw new FabricError("POLICY_DENIED", `Invalid ${label}`);
    return value;
  };
  const readQuery = (query: string, dialect: "postgres" | "sqlite"): string => {
    if (typeof query !== "string" || query.length > 12000)
      throw new FabricError("POLICY_DENIED", `${dialect} query exceeds bounds`);
    const text = query.trim().replace(/;$/, "").trim();
    if (!text || text.includes(";") || text.includes("\\") || /--|\/\*/.test(text))
      throw new FabricError(
        "POLICY_DENIED",
        `${dialect} inspection requires one comment-free statement`,
      );
    if (!/^(select|with|table|values|show|explain(?:\s+query\s+plan)?)(\s|$)/i.test(text))
      throw new FabricError(
        "POLICY_DENIED",
        `${dialect} inspection permits SELECT and read-only inspection statements only`,
      );
    if (
      /\b(insert|update|delete|merge|copy|call|do|create|alter|drop|truncate|grant|revoke|vacuum|analyze|reindex|cluster|refresh|lock|listen|notify|set|reset|attach|detach|replace|upsert)\b/i.test(
        text,
      ) ||
      /\bfor\s+(update|share|no\s+key\s+update|key\s+share)\b/i.test(text) ||
      /\bselect\s+.*\binto\b/is.test(text) ||
      /\b(pg_terminate_backend|pg_cancel_backend|pg_reload_conf|pg_rotate_logfile|pg_log_backend_memory_contexts|pg_advisory|dblink|lo_import|lo_export|pg_read_file|pg_write_file|pg_ls_dir|pg_stat_file|pg_notify)\s*\(/i.test(
        text,
      ) ||
      /^explain\s+(analyze|.*\banalyze\b)/i.test(text)
    )
      throw new FabricError("POLICY_DENIED", `${dialect} statement may have side effects`);
    return text;
  };
  const inspect: FabricLiteApi["inspect"] = {
    async postgres(input: {
      query: string;
      host?: string;
      port?: number;
      user?: string;
      database?: string;
    }) {
      const query = readQuery(input.query, "postgres");
      const args = [
        "psql",
        "-X",
        "--no-psqlrc",
        "--set",
        "ON_ERROR_STOP=1",
        "--tuples-only",
        "--no-align",
      ];
      for (const [flag, value, label] of [
        ["--host", input.host, "PostgreSQL host"],
        ["--username", input.user, "PostgreSQL user"],
        ["--dbname", input.database, "PostgreSQL database"],
      ] as const) {
        const safe = safeToken(value, label);
        if (safe) args.push(flag, safe);
      }
      if (input.port !== undefined) {
        if (!Number.isInteger(input.port) || input.port < 1 || input.port > 65535)
          throw new FabricError("POLICY_DENIED", "Invalid PostgreSQL port");
        args.push("--port", String(input.port));
      }
      args.push(
        "--command",
        `BEGIN READ ONLY; SET LOCAL statement_timeout = '30s'; ${query}; ROLLBACK;`,
      );
      if (!(await gate.authorize(networkRequest("postgres", "query", args))))
        throw new FabricError("POLICY_DENIED", "PostgreSQL inspection was not approved");
      return inspectionResult(
        "postgres",
        "query",
        await command(args, root, 30000, undefined, config.shell.maxOutputChars),
      );
    },
    async redis(input: {
      command: string;
      args?: string[];
      host?: string;
      port?: number;
      database?: number;
    }) {
      if (typeof input?.command !== "string")
        throw new FabricError("POLICY_DENIED", "Redis command must be a string");
      if (input.args !== undefined && !Array.isArray(input.args))
        throw new FabricError("POLICY_DENIED", "Redis arguments must be an array");
      const operation = input.command.toUpperCase();
      const allowed = new Set([
        "PING",
        "INFO",
        "DBSIZE",
        "TYPE",
        "EXISTS",
        "TTL",
        "PTTL",
        "GET",
        "MGET",
        "STRLEN",
        "HGET",
        "HGETALL",
        "HKEYS",
        "HLEN",
        "LRANGE",
        "LLEN",
        "SMEMBERS",
        "SCARD",
        "ZRANGE",
        "ZCARD",
        "ZSCORE",
        "SCAN",
        "SSCAN",
        "HSCAN",
        "ZSCAN",
        "MEMORY",
      ]);
      if (!allowed.has(operation))
        throw new FabricError(
          "POLICY_DENIED",
          `Redis command is not read-only allowlisted: ${operation}`,
        );
      const values = input.args ?? [];
      if (
        values.length > 20 ||
        values.some((value) => typeof value !== "string" || value.length > 1024)
      )
        throw new FabricError("POLICY_DENIED", "Redis inspection arguments exceed bounds");
      if (operation === "MEMORY" && values[0]?.toUpperCase() !== "USAGE")
        throw new FabricError("POLICY_DENIED", "Only Redis MEMORY USAGE is allowed");
      const args = ["redis-cli", "--raw"];
      const host = safeToken(input.host, "Redis host");
      if (host) args.push("-h", host);
      if (input.port !== undefined) {
        if (!Number.isInteger(input.port) || input.port < 1 || input.port > 65535)
          throw new FabricError("POLICY_DENIED", "Invalid Redis port");
        args.push("-p", String(input.port));
      }
      if (input.database !== undefined) {
        if (!Number.isInteger(input.database) || input.database < 0 || input.database > 255)
          throw new FabricError("POLICY_DENIED", "Invalid Redis database");
        args.push("-n", String(input.database));
      }
      args.push(operation, ...values);
      if (!(await gate.authorize(networkRequest("redis", operation, args))))
        throw new FabricError("POLICY_DENIED", "Redis inspection was not approved");
      return inspectionResult(
        "redis",
        operation,
        await command(args, root, 30000, undefined, config.shell.maxOutputChars),
      );
    },
    async sqlite(input: { path: string; query: string }) {
      const database = await safePath(root, input.path);
      const query = readQuery(input.query, "sqlite");
      const args = ["sqlite3", "-readonly", "-safe", "-batch", "-noheader", database, query];
      return inspectionResult(
        "sqlite",
        "query",
        await command(args, root, 30000, undefined, config.shell.maxOutputChars),
      );
    },
    async kubernetes(input: {
      operation: string;
      resource?: string;
      name?: string;
      namespace?: string;
      context?: string;
      container?: string;
      tail?: number;
    }) {
      const operation = input.operation;
      const allowed = new Set([
        "get",
        "describe",
        "logs",
        "explain",
        "api-resources",
        "api-versions",
      ]);
      if (!allowed.has(operation))
        throw new FabricError(
          "POLICY_DENIED",
          `Kubernetes operation is not read-only allowlisted: ${operation}`,
        );
      const resource = safeToken(input.resource, "Kubernetes resource", /^[A-Za-z0-9._\/-]+$/);
      if (
        resource &&
        /(^|\/)(secrets?|tokenreviews?|subjectaccessreviews?)(\.|\/|$)/i.test(resource)
      )
        throw new FabricError("POLICY_DENIED", "Sensitive Kubernetes resources are denied");
      const args = ["kubectl"];
      const context = safeToken(input.context, "Kubernetes context");
      const namespace = safeToken(input.namespace, "Kubernetes namespace");
      if (context) args.push("--context", context);
      if (namespace) args.push("--namespace", namespace);
      args.push(operation);
      if (["get", "describe", "explain"].includes(operation)) {
        if (!resource) throw new FabricError("POLICY_DENIED", `${operation} requires a resource`);
        args.push(resource);
        const name = safeToken(input.name, "Kubernetes name");
        if (name) args.push(name);
        if (operation === "get") args.push("-o", "yaml");
      } else if (operation === "logs") {
        const name = safeToken(input.name, "pod name");
        if (!name) throw new FabricError("POLICY_DENIED", "logs requires a pod name");
        args.push(name, "--tail", String(Math.min(Math.max(input.tail ?? 200, 1), 1000)));
        const container = safeToken(input.container, "container");
        if (container) args.push("--container", container);
      }
      if (!(await gate.authorize(networkRequest("kubernetes", operation, args))))
        throw new FabricError("POLICY_DENIED", "Kubernetes inspection was not approved");
      return inspectionResult(
        "kubernetes",
        operation,
        await command(args, root, 30000, undefined, config.shell.maxOutputChars),
      );
    },
    async terraform(input: { operation: string; cwd?: string; path?: string }) {
      const operation = input.operation;
      const directory = await safePath(root, input.cwd ?? ".");
      const args = ["terraform", "-chdir=" + directory];
      if (operation === "validate") args.push("validate", "-json");
      else if (operation === "show") {
        args.push("show", "-json");
        if (input.path) args.push(await safePath(root, input.path));
      } else if (operation === "state-list") args.push("state", "list");
      else if (operation === "providers-schema") args.push("providers", "schema", "-json");
      else
        throw new FabricError(
          "POLICY_DENIED",
          `Terraform operation is not read-only allowlisted: ${operation}`,
        );
      return inspectionResult(
        "terraform",
        operation,
        await command(args, root, 30000, undefined, config.shell.maxOutputChars),
      );
    },
  };
  return inspect;
}
