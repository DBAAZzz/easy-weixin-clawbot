import type { AgentMessage, ToolResultMessage } from "../llm/types.js";
import type { SkillRegistry } from "../skills/types.js";
import type { CompiledSkill } from "../skills/types.js";
import type { ToolContent } from "../tools/types.js";

const DEFAULT_MAX_ON_DEMAND_SKILLS = 3;

export interface ConversationSkillRuntimeConfig {
  registry: SkillRegistry;
  maxOnDemandSkills?: number;
  initiallyLoadedSkills?: Iterable<string>;
}

export interface ConversationSkillRuntime {
  execute(skillName: string): Promise<ToolContent[]>;
  loadedSkillNames(): string[];
}

export function wrapSkillEnvelope(skill: CompiledSkill): string {
  return [
    `<skill name="${skill.source.name}" version="${skill.source.version}">`,
    "以下是已加载的技能指令。你必须在本次对话的后续回复中严格遵循这些指令来完成用户的请求。",
    "如果你已加载了多个技能，请综合所有已加载技能的指令来完成任务。",
    "",
    skill.source.body,
    "</skill>",
  ].join("\n");
}

export function collectLoadedSkillNames(messages: AgentMessage[]): string[] {
  const loaded = new Set<string>();
  const pattern = /<skill name="([^"]+)"/g;

  for (const message of messages) {
    if (message.role !== "toolResult") {
      continue;
    }

    const toolResult = message as ToolResultMessage;
    for (const block of toolResult.content) {
      if (block.type !== "text") {
        continue;
      }

      for (const match of block.text.matchAll(pattern)) {
        loaded.add(match[1]);
      }
    }
  }

  return [...loaded];
}

export function createConversationSkillRuntime(
  config: ConversationSkillRuntimeConfig,
): ConversationSkillRuntime {
  const loadedSkillNames = new Set(config.initiallyLoadedSkills ?? []);
  const maxOnDemandSkills = config.maxOnDemandSkills ?? DEFAULT_MAX_ON_DEMAND_SKILLS;

  return {
    async execute(skillName) {
      if (loadedSkillNames.has(skillName)) {
        return [{ type: "text", text: "ok" }];
      }

      if (loadedSkillNames.size >= maxOnDemandSkills) {
        const loaded = [...loadedSkillNames].join(", ");
        return [
          {
            type: "text",
            text: `本次对话已加载 ${loadedSkillNames.size} 个技能（${loaded}），已达上限。请使用已加载的技能完成任务。`,
          },
        ];
      }

      const skill = config.registry.getOnDemandSkill(skillName);
      if (!skill) {
        return [{ type: "text", text: `未找到技能: ${skillName}` }];
      }

      loadedSkillNames.add(skillName);

      return [{ type: "text", text: wrapSkillEnvelope(skill) }];
    },

    loadedSkillNames() {
      return [...loadedSkillNames];
    },
  };
}
