import process from "node:process";

const lines = [];

function writeMessage(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function handleRequest(message) {
  switch (message.method) {
    case "initialize":
      writeMessage({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: {
            tools: {
              listChanged: false,
            },
          },
          serverInfo: {
            name: "mock-mcp-server",
            version: "1.0.0",
          },
        },
      });
      return;
    case "tools/list":
      writeMessage({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          tools: [
            {
              name: "echo",
              description: "Echo back the provided text",
              inputSchema: {
                type: "object",
                properties: {
                  text: {
                    type: "string",
                    description: "Text to echo",
                  },
                },
                required: ["text"],
                additionalProperties: false,
              },
            },
          ],
        },
      });
      return;
    case "tools/call":
      writeMessage({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          content: [
            {
              type: "text",
              text: `echo:${String(message.params?.arguments?.text ?? "")}`,
            },
          ],
          isError: false,
        },
      });
      return;
    default:
      writeMessage({
        jsonrpc: "2.0",
        id: message.id,
        error: {
          code: -32601,
          message: `Method not found: ${message.method}`,
        },
      });
  }
}

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  lines.push(...chunk.split("\n"));

  while (lines.length > 1) {
    const line = lines.shift();
    if (!line || !line.trim()) {
      continue;
    }

    const message = JSON.parse(line);
    if (message.jsonrpc !== "2.0" || typeof message.method !== "string") {
      continue;
    }

    if ("id" in message) {
      handleRequest(message);
    }
  }
});
