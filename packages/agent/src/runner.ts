import {
  complete,
  type AssistantMessage,
  type Message,
  type Model,
  type Tool,
  type ToolCall,
  type ToolResultMessage,
  Type,
} from "@mariozechner/pi-ai";
import type { SkillRegistry } from "./skills/types.js";
import type { ToolRegistry, ToolContent } from "./tools/types.js";
import {
  collectLoadedSkillNames,
  createConversationSkillRuntime,
} from "./runtime/skill-runtime.js";

export interface AgentConfig {
  model: Model<any>;
  systemPrompt: string;
  apiKey?: string;
  maxRounds?: number;
  toolTimeoutMs?: number;
  maxOnDemandSkills?: number;
}

export interface RunCallbacks {
  onMessage(msg: Message): void;
  onRoundStart?(round: number): void;
}

export type RunResult =
  | { status: "completed"; finalMessage: AssistantMessage }
  | { status: "max_rounds"; lastMessage: AssistantMessage; rounds: number }
  | { status: "aborted" };

export interface AgentRunner {
  run(
    messages: Message[],
    callbacks: RunCallbacks,
    signal?: AbortSignal,
  ): Promise<RunResult>;
}

function isToolCall(block: AssistantMessage["content"][number]): block is ToolCall {
  return block.type === "toolCall";
}

function createToolSignal(parentSignal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const signals = [AbortSignal.timeout(timeoutMs)];
  if (parentSignal) {
    signals.push(parentSignal);
  }
  return AbortSignal.any(signals);
}

const USE_SKILL_TOOL: Tool = {
  name: "use_skill",
  description: "加载一个技能到当前对话。加载后，你将获得该技能的完整指令，按指令完成用户任务。",
  parameters: Type.Object({
    skill_name: Type.String({
      description: "要加载的技能名称",
    }),
  }),
};

function toErrorText(error: unknown): string {
  if (error instanceof Error) {
    return error.message || error.toString();
  }
  return String(error);
}

function buildSystemPrompt(basePrompt: string, skills: SkillRegistry): string {
  const snapshot = skills.current();
  let systemPrompt = basePrompt;

  for (const skill of snapshot.alwaysOn) {
    systemPrompt += `\n\n[Skill: ${skill.name}]\n${skill.body}`;
  }

  if (snapshot.index.length > 0) {
    systemPrompt += "\n\n你有以下可用技能，需要时调用 use_skill 加载：";
    for (const skill of snapshot.index) {
      systemPrompt += `\n- ${skill.name}: ${skill.summary}`;
    }
  }

  return systemPrompt;
}

function buildToolResult(
  toolCallId: string,
  toolName: string,
  content: ToolContent[],
  isError: boolean,
): ToolResultMessage {
  return {
    role: "toolResult",
    toolCallId,
    toolName,
    content,
    isError,
    timestamp: Date.now(),
  };
}

export function createAgentRunner(
  config: AgentConfig,
  tools: ToolRegistry,
  skills: SkillRegistry,
): AgentRunner {
  async function run(
    messages: Message[],
    callbacks: RunCallbacks,
    signal?: AbortSignal,
  ): Promise<RunResult> {
    const maxRounds = config.maxRounds ?? 10;
    const timeoutMs = config.toolTimeoutMs ?? 30_000;
    const workingHistory = [...messages];
    const skillRuntime = createConversationSkillRuntime({
      registry: skills,
      maxOnDemandSkills: config.maxOnDemandSkills,
      initiallyLoadedSkills: collectLoadedSkillNames(workingHistory),
    });

    for (let round = 1; round <= maxRounds; round += 1) {
      if (signal?.aborted) {
        return { status: "aborted" };
      }

      callbacks.onRoundStart?.(round);

      const response = await complete(
        config.model,
        {
          systemPrompt: buildSystemPrompt(config.systemPrompt, skills),
          messages: workingHistory,
          tools: [...tools.current().tools, USE_SKILL_TOOL],
        },
        config.apiKey ? { apiKey: config.apiKey, signal } : { signal },
      );

      workingHistory.push(response);
      callbacks.onMessage(response);

      if (response.stopReason !== "toolUse") {
        return { status: "completed", finalMessage: response };
      }

      const toolCalls = response.content.filter(isToolCall);

      const toolResults = await Promise.all(
        toolCalls.map(async (toolCall) => {
          try {
            const content =
              toolCall.name === USE_SKILL_TOOL.name
                ? await skillRuntime.execute(
                    typeof toolCall.arguments.skill_name === "string"
                      ? toolCall.arguments.skill_name.trim()
                      : "",
                  )
                : await tools.execute(
                    toolCall.name,
                    toolCall.arguments,
                    createToolContext(signal, timeoutMs),
                  );

            return buildToolResult(toolCall.id, toolCall.name, content, false);
          } catch (error) {
            return buildToolResult(
              toolCall.id,
              toolCall.name,
              [{ type: "text", text: toErrorText(error) }],
              true,
            );
          }
        }),
      );

      for (const toolResult of toolResults) {
        workingHistory.push(toolResult);
        callbacks.onMessage(toolResult);
      }
    }

    const lastMessage = [...workingHistory]
      .reverse()
      .find((message): message is AssistantMessage => message.role === "assistant");

    if (!lastMessage) {
      return { status: "aborted" };
    }

    return {
      status: "max_rounds",
      lastMessage,
      rounds: maxRounds,
    };
  }

  return { run };
}

function createToolContext(
  parentSignal: AbortSignal | undefined,
  timeoutMs: number,
): { signal: AbortSignal } {
  return {
    signal: createToolSignal(parentSignal, timeoutMs),
  };
}
