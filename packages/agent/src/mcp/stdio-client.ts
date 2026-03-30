import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type {
  McpRemoteTool,
  McpToolCallResult,
  StdioMcpClient,
  StdioMcpClientOptions,
} from "./types.js";

const SUPPORTED_PROTOCOL_VERSIONS = [
  "2025-11-05",
  "2025-06-18",
  "2025-03-26",
  "2024-11-05",
] as const;

const CONNECT_TIMEOUT_MS = 30_000;

type JsonRpcSuccess = {
  jsonrpc: "2.0";
  id: number;
  result: Record<string, unknown>;
};

type JsonRpcError = {
  jsonrpc: "2.0";
  id: number;
  error: {
    code?: number;
    message?: string;
    data?: unknown;
  };
};

type JsonRpcNotification = {
  jsonrpc: "2.0";
  method: string;
  params?: Record<string, unknown>;
};

type JsonRpcMessage = JsonRpcSuccess | JsonRpcError | JsonRpcNotification;

type PendingRequest = {
  resolve: (value: Record<string, unknown>) => void;
  reject: (error: Error) => void;
  disposeSignal?: () => void;
};

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function createAbortError(): Error {
  const error = new Error("The operation was aborted");
  error.name = "AbortError";
  return error;
}

function summarizeUnknownContent(block: Record<string, unknown>): string {
  const type = typeof block.type === "string" ? block.type : "unknown";

  if (type === "resource" || type === "resource_link") {
    const uri =
      typeof block.uri === "string"
        ? block.uri
        : typeof block.resource === "object" &&
            block.resource &&
            "uri" in block.resource &&
            typeof (block.resource as { uri?: unknown }).uri === "string"
          ? ((block.resource as { uri?: string }).uri ?? "")
          : "";
    return uri ? `[${type}: ${uri}]` : `[${type}]`;
  }

  return `[unsupported MCP content: ${type}]`;
}

function mapContentBlocks(content: unknown): McpToolCallResult["content"] {
  if (!Array.isArray(content)) {
    return [{ type: "text", text: "[empty MCP result]" }];
  }

  const mapped: McpToolCallResult["content"] = [];

  for (const block of content) {
    if (!block || typeof block !== "object") {
      continue;
    }

    const record = block as Record<string, unknown>;
    const type = record.type;

    if (type === "text" && typeof record.text === "string") {
      mapped.push({ type: "text", text: record.text });
      continue;
    }

    if (
      type === "image" &&
      typeof record.data === "string" &&
      typeof record.mimeType === "string"
    ) {
      mapped.push({
        type: "image",
        data: record.data,
        mimeType: record.mimeType,
      });
      continue;
    }

    mapped.push({ type: "text", text: summarizeUnknownContent(record) });
  }

  return mapped.length > 0 ? mapped : [{ type: "text", text: "[empty MCP result]" }];
}

function ensureToolArray(value: unknown): McpRemoteTool[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const tools: McpRemoteTool[] = [];

  for (const item of value) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const record = item as Record<string, unknown>;
    if (typeof record.name !== "string" || record.name.trim() === "") {
      continue;
    }

    const inputSchema =
      record.inputSchema && typeof record.inputSchema === "object" && !Array.isArray(record.inputSchema)
        ? (record.inputSchema as Record<string, unknown>)
        : {};

    tools.push({
      name: record.name.trim(),
      description: typeof record.description === "string" ? record.description.trim() : undefined,
      inputSchema,
    });
  }

  return tools;
}

function buildRequestError(error: JsonRpcError["error"]): Error {
  const code = typeof error.code === "number" ? `[${error.code}] ` : "";
  return new Error(`${code}${error.message ?? "MCP request failed"}`);
}

function createRequestPayload(
  id: number,
  method: string,
  params?: Record<string, unknown>,
): string {
  return JSON.stringify({
    jsonrpc: "2.0",
    id,
    method,
    params,
  });
}

export function createStdioMcpClient(options: StdioMcpClientOptions): StdioMcpClient {
  let child: ChildProcessWithoutNullStreams | null = null;
  let buffer = "";
  let nextId = 1;
  let connected = false;
  let closing = false;
  let queue = Promise.resolve();
  let stderrBuffer = "";
  const pending = new Map<number, PendingRequest>();

  function rejectPending(error: Error) {
    for (const entry of pending.values()) {
      entry.disposeSignal?.();
      entry.reject(error);
    }
    pending.clear();
  }

  function handleClose(error?: Error) {
    const closeError =
      error ??
      (stderrBuffer.trim()
        ? new Error(stderrBuffer.trim())
        : new Error("MCP server process exited"));

    connected = false;
    const shouldNotify = !closing;
    closing = false;
    child = null;
    rejectPending(closeError);

    if (shouldNotify) {
      options.onClose?.(closeError);
    }
  }

  function handleMessage(message: JsonRpcMessage) {
    if ("id" in message) {
      const entry = pending.get(message.id);
      if (!entry) {
        return;
      }

      pending.delete(message.id);
      entry.disposeSignal?.();

      if ("error" in message) {
        entry.reject(buildRequestError(message.error));
        return;
      }

      entry.resolve(message.result);
      return;
    }

    if (message.method === "notifications/tools/list_changed") {
      options.onToolsListChanged?.();
    }
  }

  function bindProcess(processHandle: ChildProcessWithoutNullStreams) {
    processHandle.stdout.setEncoding("utf8");
    processHandle.stderr.setEncoding("utf8");

    processHandle.stdout.on("data", (chunk: string) => {
      buffer += chunk;

      while (true) {
        const newlineIndex = buffer.indexOf("\n");
        if (newlineIndex < 0) {
          break;
        }

        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);

        if (!line) {
          continue;
        }

        try {
          const parsed = JSON.parse(line) as JsonRpcMessage;
          if (parsed && parsed.jsonrpc === "2.0") {
            handleMessage(parsed);
          }
        } catch {
          // 跳过畸形行，不关闭连接
        }
      }
    });

    processHandle.stderr.on("data", (chunk: string) => {
      stderrBuffer = `${stderrBuffer}${chunk}`.slice(-8_000);
    });

    processHandle.once("error", (error) => {
      handleClose(toError(error));
    });

    processHandle.once("exit", (code, signal) => {
      const reason = signal
        ? `MCP server exited with signal ${signal}`
        : `MCP server exited with code ${String(code ?? 0)}`;
      handleClose(new Error(stderrBuffer.trim() || reason));
    });
  }

  async function request(
    method: string,
    params?: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    if (!child) {
      throw new Error("MCP client is not connected");
    }

    const id = nextId++;
    const processHandle = child;

    return new Promise<Record<string, unknown>>((resolve, reject) => {
      if (signal?.aborted) {
        reject(createAbortError());
        return;
      }

      const entry: PendingRequest = {
        resolve,
        reject,
      };

      if (signal) {
        const onAbort = () => {
          pending.delete(id);
          reject(createAbortError());
        };
        signal.addEventListener("abort", onAbort, { once: true });
        entry.disposeSignal = () => {
          signal.removeEventListener("abort", onAbort);
        };
      }

      pending.set(id, entry);
      processHandle.stdout.resume();
      processHandle.stdin.write(`${createRequestPayload(id, method, params)}\n`, "utf8");
    });
  }

  async function runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const task = queue.then(operation, operation);
    queue = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  }

  return {
    async connect() {
      if (connected) {
        return;
      }

      if (child) {
        throw new Error("MCP client is already connecting");
      }

      stderrBuffer = "";
      buffer = "";
      closing = false;

      const processHandle = spawn(options.command, options.args ?? [], {
        stdio: "pipe",
        cwd: options.cwd ?? undefined,
        env: {
          ...process.env,
          ...(options.env ?? {}),
        },
      });

      child = processHandle;
      bindProcess(processHandle);

      const timeoutHandle = setTimeout(() => {
        processHandle.kill("SIGTERM");
      }, CONNECT_TIMEOUT_MS);

      let response: Record<string, unknown>;
      try {
        response = await request("initialize", {
          protocolVersion: SUPPORTED_PROTOCOL_VERSIONS[0],
          capabilities: {},
          clientInfo: {
            name: "weixin-clawbot-agent",
            version: "1.0.0",
          },
        });
      } finally {
        clearTimeout(timeoutHandle);
      }

      const protocolVersion = response.protocolVersion;
      if (
        typeof protocolVersion !== "string" ||
        !SUPPORTED_PROTOCOL_VERSIONS.includes(protocolVersion as (typeof SUPPORTED_PROTOCOL_VERSIONS)[number])
      ) {
        throw new Error(`Unsupported MCP protocol version: ${String(protocolVersion ?? "")}`);
      }

      connected = true;
      processHandle.stdin.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          method: "notifications/initialized",
        })}\n`,
        "utf8",
      );
    },

    async close() {
      if (!child) {
        connected = false;
        return;
      }

      const processHandle = child;
      closing = true;
      child = null;
      connected = false;
      rejectPending(new Error("MCP client closed"));
      processHandle.kill("SIGTERM");
    },

    async listTools(signal) {
      return runExclusive(async () => {
        const tools: McpRemoteTool[] = [];
        let cursor: string | undefined;

        do {
          const response = await request(
            "tools/list",
            cursor ? { cursor } : undefined,
            signal,
          );

          tools.push(...ensureToolArray(response.tools));
          cursor = typeof response.nextCursor === "string" ? response.nextCursor : undefined;
        } while (cursor);

        return tools;
      });
    },

    async callTool(name, args, signal) {
      return runExclusive(async (): Promise<McpToolCallResult> => {
        const response = await request(
          "tools/call",
          {
            name,
            arguments: args,
          },
          signal,
        );

        return {
          content: mapContentBlocks(response.content),
          isError: response.isError === true,
        };
      });
    },
  };
}
