import type {
  AppendResult,
  ArtifactKind,
  ArtifactRevision,
  PutArtifactRevisionInput,
} from "../shared/fact-ledger/contracts.js";
import { createPortSlot } from "./slot.js";

export interface ArtifactContentIdentity {
  kind: ArtifactKind;
  schemaVersion: number;
  sha256: string;
}

export interface ArtifactRevisionStore {
  put(input: PutArtifactRevisionInput): Promise<AppendResult<ArtifactRevision>>;
  getById(artifactId: string): Promise<ArtifactRevision | null>;
  getByContent(input: ArtifactContentIdentity): Promise<ArtifactRevision | null>;
}

export const { set: setArtifactRevisionStore, get: getArtifactRevisionStore } =
  createPortSlot<ArtifactRevisionStore>("ArtifactRevisionStore", "setArtifactRevisionStore");
