import {
  FactLedgerContentHashMismatchError,
  FactLedgerIdConflictError,
  parsePutArtifactRevisionInput,
  sha256CanonicalJson,
  type AppendResult,
  type ArtifactContentIdentity,
  type ArtifactRevision,
  type ArtifactRevisionStore,
  type JsonValue,
  type PutArtifactRevisionInput,
} from "@clawbot/agent";
import type { PrismaClient } from "@prisma/client";
import { artifactRevisionFromRow, toNullablePrismaJson } from "./fact-ledger/codec.js";
import { artifactMatchesIdRetry } from "./fact-ledger/equivalence.js";
import { isPrismaUniqueConstraintError } from "./fact-ledger/errors.js";
import { getPrisma } from "./prisma.js";

export class PrismaArtifactRevisionStore implements ArtifactRevisionStore {
  constructor(private readonly injectedPrisma?: PrismaClient) {}

  private get prisma(): PrismaClient {
    return this.injectedPrisma ?? getPrisma();
  }

  async put(rawInput: PutArtifactRevisionInput): Promise<AppendResult<ArtifactRevision>> {
    const input = parsePutArtifactRevisionInput(rawInput);
    this.verifyInlineHash(input);

    try {
      const existingById = await this.getById(input.artifactId);
      if (existingById) return this.resolveIdRetry(existingById, input);

      const existingByContent = await this.getByContent(input);
      if (existingByContent) return { value: existingByContent, appended: false };

      const isInline = input.inlineJson !== undefined;
      const row = await this.prisma.artifactRevision.create({
        data: {
          artifactId: input.artifactId,
          kind: input.kind,
          sha256: input.sha256,
          schemaVersion: input.schemaVersion,
          contentLocation: isInline ? "inline" : "external",
          inlineJson: toNullablePrismaJson(input.inlineJson),
          storageRef: toNullablePrismaJson(input.storageRef as JsonValue | undefined),
          encryptionMetadata: toNullablePrismaJson(
            input.encryptionMetadata as JsonValue | undefined,
          ),
        },
      });
      return { value: artifactRevisionFromRow(row), appended: true };
    } catch (error) {
      if (!isPrismaUniqueConstraintError(error)) throw error;

      const existingById = await this.getById(input.artifactId);
      if (existingById) return this.resolveIdRetry(existingById, input);
      const existingByContent = await this.getByContent(input);
      if (existingByContent) return { value: existingByContent, appended: false };
      throw new FactLedgerIdConflictError("artifact", input.artifactId);
    }
  }

  async getById(artifactId: string): Promise<ArtifactRevision | null> {
    const row = await this.prisma.artifactRevision.findUnique({ where: { artifactId } });
    return row ? artifactRevisionFromRow(row) : null;
  }

  async getByContent(input: ArtifactContentIdentity): Promise<ArtifactRevision | null> {
    const row = await this.prisma.artifactRevision.findUnique({
      where: {
        kind_schemaVersion_sha256: {
          kind: input.kind,
          schemaVersion: input.schemaVersion,
          sha256: input.sha256,
        },
      },
    });
    return row ? artifactRevisionFromRow(row) : null;
  }

  private verifyInlineHash(input: PutArtifactRevisionInput): void {
    if (input.inlineJson !== undefined && sha256CanonicalJson(input.inlineJson) !== input.sha256) {
      throw new FactLedgerContentHashMismatchError(input.artifactId);
    }
  }

  private resolveIdRetry(
    stored: ArtifactRevision,
    input: PutArtifactRevisionInput,
  ): AppendResult<ArtifactRevision> {
    if (!artifactMatchesIdRetry(stored, input)) {
      throw new FactLedgerIdConflictError("artifact", input.artifactId);
    }
    return { value: stored, appended: false };
  }
}
