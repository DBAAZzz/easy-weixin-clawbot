import { decryptToken, encryptToken, getMasterKey } from "../credentials/crypto.js";
import { getPrisma } from "../db/prisma.js";
import {
  type WebSearchProviderType,
  isWebSearchProviderType,
} from "./provider-types.js";

type PrismaWebSearchProviderRow = {
  id: bigint;
  providerType: string;
  apiKeyCiphertext: string;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export interface WebSearchProviderRow {
  id: bigint;
  providerType: WebSearchProviderType;
  apiKeySet: boolean;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface DecryptedWebSearchProvider {
  id: bigint;
  providerType: WebSearchProviderType;
  apiKey: string;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateWebSearchProviderInput {
  providerType: WebSearchProviderType;
  apiKey: string;
  enabled?: boolean;
}

export interface UpdateWebSearchProviderInput {
  apiKey?: string;
  enabled?: boolean;
}

export interface WebSearchProviderStore {
  list(): Promise<WebSearchProviderRow[]>;
  get(providerType: WebSearchProviderType): Promise<WebSearchProviderRow | null>;
  create(input: CreateWebSearchProviderInput): Promise<WebSearchProviderRow>;
  update(
    providerType: WebSearchProviderType,
    input: UpdateWebSearchProviderInput,
  ): Promise<WebSearchProviderRow>;
  enable(providerType: WebSearchProviderType): Promise<WebSearchProviderRow>;
  disable(providerType: WebSearchProviderType): Promise<WebSearchProviderRow>;
  listEnabledWithApiKeys(): Promise<DecryptedWebSearchProvider[]>;
}

function encryptionScope(providerType: WebSearchProviderType): string {
  return `web-search-provider:${providerType}`;
}

function encodeCiphertext(row: { ciphertext: Buffer; iv: Buffer; authTag: Buffer }): string {
  return [row.iv, row.authTag, row.ciphertext]
    .map((part) => part.toString("base64url"))
    .join(".");
}

function decodeCiphertext(value: string): { ciphertext: Buffer; iv: Buffer; authTag: Buffer } {
  const parts = value.split(".");
  if (parts.length !== 3 || parts.some((part) => !part)) {
    throw new Error("Invalid web search provider ciphertext");
  }

  return {
    iv: Buffer.from(parts[0], "base64url"),
    authTag: Buffer.from(parts[1], "base64url"),
    ciphertext: Buffer.from(parts[2], "base64url"),
  };
}

function toRow(row: PrismaWebSearchProviderRow): WebSearchProviderRow {
  if (!isWebSearchProviderType(row.providerType)) {
    throw new Error(`Unsupported web search provider type: ${row.providerType}`);
  }

  return {
    id: row.id,
    providerType: row.providerType,
    apiKeySet: row.apiKeyCiphertext.trim().length > 0,
    enabled: row.enabled,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toDecryptedRow(row: PrismaWebSearchProviderRow): DecryptedWebSearchProvider {
  if (!isWebSearchProviderType(row.providerType)) {
    throw new Error(`Unsupported web search provider type: ${row.providerType}`);
  }

  const masterKey = getMasterKey();
  const apiKey = decryptToken(
    decodeCiphertext(row.apiKeyCiphertext),
    encryptionScope(row.providerType),
    masterKey,
  );

  return {
    id: row.id,
    providerType: row.providerType,
    apiKey,
    enabled: row.enabled,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function encryptApiKey(providerType: WebSearchProviderType, apiKey: string): string {
  const masterKey = getMasterKey();
  const encrypted = encryptToken(apiKey, encryptionScope(providerType), masterKey);
  return encodeCiphertext(encrypted);
}

export const webSearchProviderStore: WebSearchProviderStore = {
  async list() {
    const rows = await getPrisma().webSearchProvider.findMany({
      orderBy: { providerType: "asc" },
    });
    return rows.map((row) => toRow(row));
  },

  async get(providerType) {
    const row = await getPrisma().webSearchProvider.findUnique({
      where: { providerType },
    });
    return row ? toRow(row) : null;
  },

  async create(input) {
    const row = await getPrisma().webSearchProvider.create({
      data: {
        providerType: input.providerType,
        apiKeyCiphertext: encryptApiKey(input.providerType, input.apiKey),
        enabled: input.enabled ?? true,
      },
    });
    return toRow(row);
  },

  async update(providerType, input) {
    const data: {
      enabled?: boolean;
      apiKeyCiphertext?: string;
    } = {};

    if (input.enabled !== undefined) {
      data.enabled = input.enabled;
    }
    if (input.apiKey !== undefined) {
      data.apiKeyCiphertext = encryptApiKey(providerType, input.apiKey);
    }

    const row = await getPrisma().webSearchProvider.update({
      where: { providerType },
      data,
    });
    return toRow(row);
  },

  async enable(providerType) {
    return this.update(providerType, { enabled: true });
  },

  async disable(providerType) {
    return this.update(providerType, { enabled: false });
  },

  async listEnabledWithApiKeys() {
    const rows = await getPrisma().webSearchProvider.findMany({
      where: { enabled: true },
      orderBy: { providerType: "asc" },
    });
    return rows.map((row) => toDecryptedRow(row));
  },
};