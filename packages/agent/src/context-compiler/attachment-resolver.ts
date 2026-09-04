import type { ResolvedAttachmentArtifact } from "./types.js";

export interface AttachmentArtifactResolver {
  resolve(input: {
    accountId: string;
    sourceRefs: string[];
  }): Promise<Map<string, ResolvedAttachmentArtifact>>;
}

export const unresolvedAttachmentArtifactResolver: AttachmentArtifactResolver = {
  async resolve() {
    return new Map();
  },
};
