import { createHash, createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { AssetBlobStore, AssetStorageRef } from "@clawbot/asset";

export interface S3CompatibleAssetBlobStoreConfig {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicBaseUrl?: string;
}

const EMPTY_SHA256 = sha256Hex("");

function sha256Hex(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function hmac(key: string | Uint8Array, value: string): Buffer {
  return createHmac("sha256", key).update(value).digest();
}

function hmacHex(key: string | Uint8Array, value: string): string {
  return createHmac("sha256", key).update(value).digest("hex");
}

function formatAmzDate(date: Date): string {
  return date.toISOString().replaceAll(/[:-]|\.\d{3}/g, "");
}

function formatDateStamp(date: Date): string {
  return date.toISOString().slice(0, 10).replaceAll("-", "");
}

function encodePathSegment(value: string): string {
  return encodeURIComponent(value).replaceAll("%2F", "/");
}

function normalizeHeaderValue(value: string): string {
  return value.trim().replaceAll(/\s+/g, " ");
}

function toCanonicalQuery(params: URLSearchParams): string {
  return [...params.entries()]
    .sort(([aKey, aValue], [bKey, bValue]) => {
      const keyCompare = aKey.localeCompare(bKey);
      return keyCompare === 0 ? aValue.localeCompare(bValue) : keyCompare;
    })
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
}

function buildSigningKey(secretAccessKey: string, dateStamp: string, region: string): Buffer {
  const dateKey = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const regionKey = hmac(dateKey, region);
  const serviceKey = hmac(regionKey, "s3");
  return hmac(serviceKey, "aws4_request");
}

function assertS3Ref(ref: AssetStorageRef): Extract<AssetStorageRef, { provider: "s3-compatible" }> {
  if (ref.provider !== "s3-compatible") {
    throw new Error(`S3CompatibleAssetBlobStore cannot use provider: ${ref.provider}`);
  }
  return ref;
}

export class S3CompatibleAssetBlobStore implements AssetBlobStore {
  constructor(private readonly config: S3CompatibleAssetBlobStoreConfig) {}

  async put(input: {
    sourcePath: string;
    key: string;
    mimeType: string;
    metadata?: Record<string, string>;
  }): Promise<AssetStorageRef> {
    const bytes = await readFile(input.sourcePath);
    const headers: Record<string, string> = {
      "content-type": input.mimeType,
    };
    for (const [key, value] of Object.entries(input.metadata ?? {})) {
      headers[`x-amz-meta-${key.toLowerCase()}`] = value;
    }
    await this.request({
      method: "PUT",
      key: input.key,
      headers,
      body: bytes,
    });
    return {
      provider: "s3-compatible",
      bucket: this.config.bucket,
      key: input.key,
      endpoint: this.config.endpoint,
    };
  }

  async get(input: {
    ref: AssetStorageRef;
  }): Promise<{
    bytes: Uint8Array;
    mimeType: string;
  }> {
    const ref = assertS3Ref(input.ref);
    const response = await this.request({
      method: "GET",
      key: ref.key,
      headers: {},
    });
    const bytes = new Uint8Array(await response.arrayBuffer());
    return {
      bytes,
      mimeType: response.headers.get("content-type") ?? "application/octet-stream",
    };
  }

  async delete(input: { ref: AssetStorageRef }): Promise<void> {
    const ref = assertS3Ref(input.ref);
    await this.request({
      method: "DELETE",
      key: ref.key,
      headers: {},
    });
  }

  async getAccessUrl(input: {
    ref: AssetStorageRef;
    expiresInSeconds: number;
  }): Promise<string> {
    const ref = assertS3Ref(input.ref);
    if (this.config.publicBaseUrl) {
      return `${this.config.publicBaseUrl.replace(/\/$/, "")}/${encodePathSegment(ref.key)}`;
    }
    return this.createSignedGetUrl(ref.key, input.expiresInSeconds);
  }

  private objectUrl(key: string): URL {
    const endpoint = this.config.endpoint.replace(/\/$/, "");
    return new URL(`${endpoint}/${encodeURIComponent(this.config.bucket)}/${encodePathSegment(key)}`);
  }

  private async request(input: {
    method: "PUT" | "GET" | "DELETE";
    key: string;
    headers: Record<string, string>;
    body?: Uint8Array;
  }): Promise<Response> {
    const url = this.objectUrl(input.key);
    const now = new Date();
    const dateStamp = formatDateStamp(now);
    const amzDate = formatAmzDate(now);
    const payloadHash = input.body ? sha256Hex(input.body) : EMPTY_SHA256;
    const headers: Record<string, string> = {
      ...Object.fromEntries(Object.entries(input.headers).map(([key, value]) => [key.toLowerCase(), value])),
      host: url.host,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
    };
    const signedHeaders = Object.keys(headers).sort().join(";");
    const canonicalHeaders = Object.keys(headers)
      .sort()
      .map((key) => `${key}:${normalizeHeaderValue(headers[key] ?? "")}\n`)
      .join("");
    const canonicalRequest = [
      input.method,
      url.pathname,
      "",
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join("\n");
    const scope = `${dateStamp}/${this.config.region}/s3/aws4_request`;
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      amzDate,
      scope,
      sha256Hex(canonicalRequest),
    ].join("\n");
    const signature = hmacHex(
      buildSigningKey(this.config.secretAccessKey, dateStamp, this.config.region),
      stringToSign,
    );
    const authorization =
      `AWS4-HMAC-SHA256 Credential=${this.config.accessKeyId}/${scope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`;

    const body = input.body ? Uint8Array.from(input.body).buffer : undefined;
    const response = await fetch(url, {
      method: input.method,
      headers: {
        ...headers,
        authorization,
      },
      body,
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`S3 ${input.method} failed: ${response.status} ${response.statusText} ${text}`);
    }
    return response;
  }

  private createSignedGetUrl(key: string, expiresInSeconds: number): string {
    const url = this.objectUrl(key);
    const now = new Date();
    const dateStamp = formatDateStamp(now);
    const amzDate = formatAmzDate(now);
    const scope = `${dateStamp}/${this.config.region}/s3/aws4_request`;
    const signedHeaders = "host";
    url.searchParams.set("X-Amz-Algorithm", "AWS4-HMAC-SHA256");
    url.searchParams.set("X-Amz-Credential", `${this.config.accessKeyId}/${scope}`);
    url.searchParams.set("X-Amz-Date", amzDate);
    url.searchParams.set("X-Amz-Expires", String(expiresInSeconds));
    url.searchParams.set("X-Amz-SignedHeaders", signedHeaders);

    const canonicalRequest = [
      "GET",
      url.pathname,
      toCanonicalQuery(url.searchParams),
      `host:${url.host}\n`,
      signedHeaders,
      "UNSIGNED-PAYLOAD",
    ].join("\n");
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      amzDate,
      scope,
      sha256Hex(canonicalRequest),
    ].join("\n");
    const signature = hmacHex(
      buildSigningKey(this.config.secretAccessKey, dateStamp, this.config.region),
      stringToSign,
    );
    url.searchParams.set("X-Amz-Signature", signature);
    return url.toString();
  }
}
