import fs from "node:fs";
import readline from "node:readline";

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

const respond = (id, result) => {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
};

const countEvent = (event) => {
  if (!process.env.KIRO_FABRIC_MCP_EVENT_FILE) return;
  fs.appendFileSync(
    process.env.KIRO_FABRIC_MCP_EVENT_FILE,
    `${process.env.KIRO_FABRIC_MCP_COUNT_LABEL ?? "server"}:${event}\n`,
  );
};

input.on("line", (line) => {
  if (!line.trim()) return;
  const request = JSON.parse(line);
  if (request.method === "initialize") {
    countEvent("initialize");
    respond(request.id, {
      protocolVersion: request.params.protocolVersion,
      capabilities: { tools: {} },
      serverInfo: { name: "kiro-fabric-test", version: "1.0.0" },
    });
    return;
  }
  if (request.method === "tools/list") {
    countEvent("tools/list");
    if (process.env.KIRO_FABRIC_MCP_COUNT_FILE) {
      fs.appendFileSync(
        process.env.KIRO_FABRIC_MCP_COUNT_FILE,
        `${process.env.KIRO_FABRIC_MCP_COUNT_LABEL ?? "server"}\n`,
      );
    }
    respond(request.id, {
      tools: [
        {
          name: "echo-value",
          description: "Echo a value",
          inputSchema: {
            type: "object",
            properties: { value: { type: "string" } },
            required: ["value"],
            additionalProperties: false,
          },
        },
        ...(process.env.KIRO_FABRIC_MCP_COLLISIONS === "1"
          ? [{
              name: "echo_value",
              description: "Colliding echo alias",
              inputSchema: {
                type: "object",
                properties: { value: { type: "string" } },
                required: ["value"],
                additionalProperties: false,
              },
            }]
          : []),
        {
          name: "get-model-schema",
          description: "Return a model schema",
          inputSchema: {
            type: "object",
            properties: { endpoint_id: { type: "string" } },
            required: ["endpoint_id"],
            additionalProperties: false,
          },
        },
      ],
    });
    return;
  }
  if (request.method === "tools/call") {
    countEvent(`tools/call:${request.params.name}`);
    const sendResult = () =>
      respond(request.id, {
        content: [{
          type: "text",
          text: request.params.name === "get-model-schema"
            ? `schema:${request.params.arguments.endpoint_id}`
            : process.env.KIRO_FABRIC_MCP_COLLISIONS === "1"
              ? `called:${request.params.name}`
              : `echo:${request.params.arguments.value}`,
        }],
      });
    if (request.params.arguments.value === "__delay__") setTimeout(sendResult, 5_000);
    else sendResult();
    return;
  }
  if (request.id !== undefined) respond(request.id, {});
});
