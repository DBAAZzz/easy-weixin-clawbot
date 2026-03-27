import type { SkillRegistry, SkillSnapshot } from "./types.js";

const EMPTY_SNAPSHOT: SkillSnapshot = {
  alwaysOn: [],
  index: [],
  onDemand: new Map(),
};

export function createSkillRegistry(initialSnapshot: SkillSnapshot = EMPTY_SNAPSHOT): SkillRegistry {
  let snapshot = initialSnapshot;

  return {
    swap(nextSnapshot) {
      snapshot = nextSnapshot;
    },

    current() {
      return snapshot;
    },

    getOnDemandSkill(name) {
      return snapshot.onDemand.get(name) ?? null;
    },
  };
}
