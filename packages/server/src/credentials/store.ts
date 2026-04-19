import { getPrisma } from "../db/prisma.js";
import { encryptToken, decryptToken, getMasterKey } from "./crypto.js";

export type CredentialStatus = "active" | "invalid" | "expired" | "revoked" | "relogin_required";

export type DecryptedCredential = {
  accountId: string;
  token: string;
  baseUrl: string;
  userId: string | null;
  status: CredentialStatus;
  keyVersion: number;
  lastLoginAt: Date | null;
  lastValidatedAt: Date | null;
  lastError: string | null;
};

export type SaveCredentialInput = {
  accountId: string;
  token: string;
  baseUrl: string;
  userId?: string;
};

/**
 * WeixinCredentialStore — the single source of truth for WeChat account credentials.
 * All tokens are stored AES-256-GCM encrypted; decryption happens only on read.
 */
export const credentialStore = {
  /**
   * Save or update credentials for an account (encrypts the token).
   */
  async save(input: SaveCredentialInput): Promise<void> {
    const masterKey = getMasterKey();
    const encrypted = encryptToken(input.token, input.accountId, masterKey);

    const ciphertext = new Uint8Array(encrypted.ciphertext);
    const iv = new Uint8Array(encrypted.iv);
    const authTag = new Uint8Array(encrypted.authTag);

    await getPrisma().weixinAccountCredential.upsert({
      where: { accountId: input.accountId },
      update: {
        tokenEncrypted: ciphertext,
        tokenIv: iv,
        tokenAuthTag: authTag,
        baseUrl: input.baseUrl,
        userId: input.userId ?? null,
        status: "active",
        keyVersion: 1,
        lastLoginAt: new Date(),
        lastError: null,
      },
      create: {
        accountId: input.accountId,
        tokenEncrypted: ciphertext,
        tokenIv: iv,
        tokenAuthTag: authTag,
        baseUrl: input.baseUrl,
        userId: input.userId ?? null,
        status: "active",
        keyVersion: 1,
        lastLoginAt: new Date(),
      },
    });
  },

  /**
   * Retrieve and decrypt a credential by account ID.
   * Returns null if no credential exists.
   */
  async getDecrypted(accountId: string): Promise<DecryptedCredential | null> {
    const row = await getPrisma().weixinAccountCredential.findUnique({
      where: { accountId },
    });
    if (!row) return null;

    const masterKey = getMasterKey();
    const token = decryptToken(
      {
        ciphertext: Buffer.from(row.tokenEncrypted.buffer, row.tokenEncrypted.byteOffset, row.tokenEncrypted.byteLength),
        iv: Buffer.from(row.tokenIv.buffer, row.tokenIv.byteOffset, row.tokenIv.byteLength),
        authTag: Buffer.from(row.tokenAuthTag.buffer, row.tokenAuthTag.byteOffset, row.tokenAuthTag.byteLength),
      },
      accountId,
      masterKey,
    );

    return {
      accountId: row.accountId,
      token,
      baseUrl: row.baseUrl,
      userId: row.userId,
      status: row.status as CredentialStatus,
      keyVersion: row.keyVersion,
      lastLoginAt: row.lastLoginAt,
      lastValidatedAt: row.lastValidatedAt,
      lastError: row.lastError,
    };
  },

  /**
   * Update the credential status (e.g. mark as relogin_required on disconnect).
   */
  async updateStatus(
    accountId: string,
    status: CredentialStatus,
    lastError?: string,
  ): Promise<void> {
    await getPrisma().weixinAccountCredential.update({
      where: { accountId },
      data: {
        status,
        ...(lastError !== undefined ? { lastError } : {}),
        ...(status === "active" ? { lastValidatedAt: new Date(), lastError: null } : {}),
      },
    });
  },

  /**
   * Get all account IDs that have an active credential.
   */
  async getActiveAccountIds(): Promise<string[]> {
    const rows = await getPrisma().weixinAccountCredential.findMany({
      where: { status: "active" },
      select: { accountId: true },
    });
    return rows.map((r) => r.accountId);
  },

  /**
   * Check if a credential exists and is active.
   */
  async isActive(accountId: string): Promise<boolean> {
    const row = await getPrisma().weixinAccountCredential.findUnique({
      where: { accountId },
      select: { status: true },
    });
    return row?.status === "active";
  },

  /**
   * Delete a credential.
   */
  async delete(accountId: string): Promise<void> {
    await getPrisma().weixinAccountCredential.deleteMany({
      where: { accountId },
    });
  },
};

/**
 * WeixinAllowFromStore — manages per-account authorized user lists.
 */
export const allowFromStore = {
  /**
   * Add a user to the allow-from list for an account.
   */
  async addUser(accountId: string, wechatUserId: string): Promise<boolean> {
    const trimmed = wechatUserId.trim();
    if (!trimmed) return false;

    try {
      await getPrisma().weixinAccountAllowFrom.upsert({
        where: {
          accountId_wechatUserId: { accountId, wechatUserId: trimmed },
        },
        update: {},
        create: { accountId, wechatUserId: trimmed },
      });
      return true;
    } catch {
      return false;
    }
  },

  /**
   * List all authorized user IDs for an account.
   */
  async listUsers(accountId: string): Promise<string[]> {
    const rows = await getPrisma().weixinAccountAllowFrom.findMany({
      where: { accountId },
      select: { wechatUserId: true },
    });
    return rows.map((r) => r.wechatUserId);
  },

  /**
   * Check if a user is authorized for an account.
   */
  async isAuthorized(accountId: string, wechatUserId: string): Promise<boolean> {
    const row = await getPrisma().weixinAccountAllowFrom.findUnique({
      where: {
        accountId_wechatUserId: { accountId, wechatUserId },
      },
    });
    return row !== null;
  },
};

/**
 * WeixinSyncStateStore — manages the long-poll sync buffer per account.
 */
export const syncStateStore = {
  /**
   * Load the sync buf for an account.
   */
  async load(accountId: string): Promise<string | undefined> {
    const row = await getPrisma().weixinSyncState.findUnique({
      where: { accountId },
      select: { syncBuf: true },
    });
    return row?.syncBuf ?? undefined;
  },

  /**
   * Save or update the sync buf for an account.
   * Uses raw SQL for performance since this is called on every long-poll response.
   */
  async save(accountId: string, syncBuf: string): Promise<void> {
    await getPrisma().$executeRaw`
      INSERT INTO weixin_sync_state (account_id, sync_buf, updated_at)
      VALUES (${accountId}, ${syncBuf}, NOW())
      ON CONFLICT (account_id)
      DO UPDATE SET sync_buf = ${syncBuf}, updated_at = NOW()
    `;
  },
};
