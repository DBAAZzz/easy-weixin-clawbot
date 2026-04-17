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
  const packageHints: string[] = [];
  const runtime = skill.detectedRuntime;

  if (skill.packageIndex?.scriptFiles.length) {
    packageHints.push(`[技能脚本]\n${skill.packageIndex.scriptFiles.map((path) => `- ${path}`).join("\n")}`);
  }

  if (skill.packageIndex?.referenceFiles.length) {
    packageHints.push(`[技能参考资料]\n${skill.packageIndex.referenceFiles.map((path) => `- ${path}`).join("\n")}`);
  }

  if (runtime && runtime.kind !== "knowledge-only") {
    const runtimeLines = [
      `[技能运行形态]`,
      `- kind: ${runtime.kind}`,
      ...(runtime.entrypoint ? [`- entrypoint: ${runtime.entrypoint.path}`] : []),
      ...(runtime.dependencies.length > 0
        ? [`- dependencies: ${runtime.dependencies.map((dependency) => dependency.name).join(", ")}`]
        : []),
      "- 如需读取 references 或 scripts 文件，使用 read_skill_file",
      "- 如需准备本地运行环境，使用 prepare_skill_runtime",
      "- 如需执行脚本，使用 run_skill_script",
    ];
    packageHints.push(runtimeLines.join("\n"));
  }

  return [
    `<skill name="${skill.source.name}" version="${skill.source.version}">`,
    "以下是已加载的技能指令。你必须在本次对话的后续回复中严格遵循这些指令来完成用户的请求。",
    "如果你已加载了多个技能，请综合所有已加载技能的指令来完成任务。",
    "",
    skill.source.body,
    ...(packageHints.length > 0 ? ["", ...packageHints] : []),
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
