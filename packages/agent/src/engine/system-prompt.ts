import type { PromptProfile } from "../prompts/types.js";
import type { SkillRegistry } from "../capabilities/skills/types.js";

/**
 * Build the final system prompt for a lane.
 *
 * @param profile - The lane's prompt profile
 * @param basePrompt - The loaded prompt asset content (already variable-resolved)
 * @param skills - Skill registry (only consulted if profile.injectSkills is true)
 */
export function assembleSystemPrompt(
  profile: PromptProfile,
  basePrompt: string,
  skills?: SkillRegistry,
): string {
  let prompt = basePrompt;

  if (profile.injectSkills && skills) {
    const snapshot = skills.current();

    for (const skill of snapshot.alwaysOn) {
      prompt += `\n\n[Skill: ${skill.name}]\n${skill.body}`;
    }

    if (snapshot.index.length > 0) {
      prompt += "\n\n你有以下可用技能，需要时调用 use_skill 加载：";
      for (const skill of snapshot.index) {
        prompt += `\n- ${skill.name}: ${skill.summary}`;
      }
    }
  }

  return prompt;
}
