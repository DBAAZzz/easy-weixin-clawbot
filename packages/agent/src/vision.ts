import { readFileSync } from "node:fs";
import { generateObject } from "ai";
import { z } from "zod";
import { sanitize, withSpan } from "@clawbot/observability";
import { MESSAGE_CONTENT_TYPE } from "@clawbot/shared";
import type {
  ImageContent,
  LanguageModel,
  TextContent,
  VisionFallbackReason,
  VisualContext,
} from "./llm/types.js";
import { modelSupportsVision } from "./llm/model-meta.js";
import { resolveConfiguredModel, type ResolvedModel } from "./model-resolver.js";
import { getPromptAssets } from "./prompts/port.js";
import { PROMPT_PROFILES } from "./prompts/profiles.js";
import type { ChatMedia } from "./types.js";
import {
  detectImageMime,
  getChatModelVisionFallbackReason,
  getVisionFailureReason,
} from "./utils/chat-utils.js";
import { extractJsonBlock } from "./utils/json.js";

const VISION_TIMEOUT_MS = 120_000;
const VISION_MAX_OUTPUT_TOKENS = 2000;
const MAX_CONTEXT_CHARS = 1200;
const MAX_OCR_ITEMS = 30;
const MAX_OBJECT_ITEMS = 12;
const MAX_ITEM_CHARS = 120;

const VISION_OUTPUT_SCHEMA = z.object({
  summary: z.string().max(240).describe("一句话概括图片中可见内容"),
  ocr_text: z
    .array(z.string().max(MAX_ITEM_CHARS))
    .max(MAX_OCR_ITEMS)
    .default([])
    .describe("图片中最重要的可见文字，按阅读顺序排列"),
  objects: z
    .array(z.string().max(MAX_ITEM_CHARS))
    .max(MAX_OBJECT_ITEMS)
    .default([])
    .describe("图片中清晰可见的主要对象、人物、界面元素或环境元素"),
});

export interface DescribeImageInput {
  model: LanguageModel;
  modelId: string;
  imageData: string;
  mimeType: string;
  imageBytes: number;
  fallbackReason?: VisionFallbackReason;
}

export interface PreparedVisualContent {
  content: (TextContent | ImageContent)[];
  visualContexts: VisualContext[];
}

interface RawVisualContext {
  summary?: unknown;
  ocr_text?: unknown;
  ocrText?: unknown;
  objects?: unknown;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => String(item).trim())
    .filter(Boolean)
    .map((item) => item.slice(0, MAX_ITEM_CHARS));
}

function parseJsonStringLiteral(value: string): string | null {
  try {
    return JSON.parse(value) as string;
  } catch {
    return null;
  }
}

function extractPartialJsonString(text: string, key: string): string | undefined {
  const pattern = new RegExp(`"${key}"\\s*:\\s*("(?:\\\\.|[^"\\\\])*")`);
  const match = pattern.exec(text);
  if (!match?.[1]) {
    return undefined;
  }
  return parseJsonStringLiteral(match[1]) ?? undefined;
}

function extractPartialJsonArray(text: string, key: string, maxItems: number): string[] {
  const keyIndex = text.indexOf(`"${key}"`);
  if (keyIndex < 0) {
    return [];
  }

  const arrayStart = text.indexOf("[", keyIndex);
  if (arrayStart < 0) {
    return [];
  }

  const nextKeyIndex = text.slice(arrayStart + 1).search(/\n\s*"[^"]+"\s*:/);
  const arrayBody =
    nextKeyIndex >= 0
      ? text.slice(arrayStart + 1, arrayStart + 1 + nextKeyIndex)
      : text.slice(arrayStart + 1);
  const values: string[] = [];
  const stringPattern = /"(?:\\.|[^"\\])*"/g;

  for (const match of arrayBody.matchAll(stringPattern)) {
    const value = parseJsonStringLiteral(match[0]);
    if (value?.trim()) {
      values.push(value.trim());
    }
    if (values.length >= maxItems) {
      break;
    }
  }

  return values;
}

function getErrorText(error: unknown): string | undefined {
  if (!error || typeof error !== "object") {
    return undefined;
  }

  const directText = (error as { text?: unknown }).text;
  if (typeof directText === "string") {
    return directText;
  }

  const cause = (error as { cause?: unknown }).cause;
  if (!cause || typeof cause !== "object") {
    return undefined;
  }

  const causeText = (cause as { text?: unknown }).text;
  return typeof causeText === "string" ? causeText : undefined;
}

function recoverVisualContextFromPartialText(
  text: string,
  modelId: string,
): VisualContext | undefined {
  const summary = extractPartialJsonString(text, "summary");
  const ocrText = extractPartialJsonArray(text, "ocr_text", MAX_OCR_ITEMS);
  const objects = extractPartialJsonArray(text, "objects", MAX_OBJECT_ITEMS);

  if (!summary && ocrText.length === 0 && objects.length === 0) {
    return undefined;
  }

  return normalizeVisualContext({ summary, ocr_text: ocrText, objects }, modelId, "vision_parse_failed");
}

function normalizeVisualContext(
  raw: RawVisualContext,
  modelId: string,
  fallbackReason?: VisionFallbackReason,
): VisualContext {
  const summary = String(raw.summary ?? "").trim();
  return {
    provider: "vision",
    modelId,
    generatedAt: new Date().toISOString(),
    summary: summary.slice(0, 240),
    ocrText: asStringArray(raw.ocr_text ?? raw.ocrText).slice(0, MAX_OCR_ITEMS),
    objects: asStringArray(raw.objects).slice(0, MAX_OBJECT_ITEMS),
    ...(fallbackReason ? { fallbackReason } : {}),
  };
}

function buildVisionPrompt(): string {
  return [
    "请只识别这张图片中可见的事实，并按 schema 输出。",
    `ocr_text 最多 ${MAX_OCR_ITEMS} 条，objects 最多 ${MAX_OBJECT_ITEMS} 条。`,
    "不要列出状态栏碎片、图表刻度、重复数字、孤立字母或无意义 OCR 碎片。",
  ].join("\n");
}

function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, maxChars)}\n[视觉摘要已截断]`;
}

export function formatVisualContextForPrompt(
  context: VisualContext,
  imageIndex?: number,
  maxChars = MAX_CONTEXT_CHARS,
): TextContent {
  const lines = [
    `<visual_context${imageIndex ? ` image_index="${imageIndex}"` : ""}>`,
    "用户上传了一张图片。当前 chat 模型不支持视觉输入，以下内容由 vision 模型生成。",
    "",
    "图片摘要：",
    context.summary || "unknown",
    "",
    "OCR 文字：",
    ...(context.ocrText.length > 0 ? context.ocrText.map((text) => `- ${text}`) : ["- unknown"]),
    "",
    "关键对象：",
    ...(context.objects.length > 0 ? context.objects.map((item) => `- ${item}`) : ["- unknown"]),
    "</visual_context>",
  ];

  return { type: MESSAGE_CONTENT_TYPE.TEXT, text: truncateText(lines.join("\n"), maxChars) };
}

export function createImagePlaceholder(reason: VisionFallbackReason): TextContent {
  const text =
    reason === "no_vision_model_configured"
      ? "[图片：当前 chat 模型不支持视觉输入，且未配置可用的 vision 模型]"
      : "[图片：当前 chat 模型不支持视觉输入，且图片识别失败]";
  return { type: MESSAGE_CONTENT_TYPE.TEXT, text };
}

export async function prepareUserVisualContent(args: {
  media: ChatMedia;
  chatModel: ResolvedModel;
  accountId: string;
  conversationId: string;
}): Promise<PreparedVisualContent> {
  const { media, chatModel, accountId, conversationId } = args;
  const content: (TextContent | ImageContent)[] = [];
  const visualContexts: VisualContext[] = [];
  let imagePromptReplacementText: string | undefined;

  const buf = readFileSync(media.filePath);
  const mimeType = detectImageMime(buf) ?? media.mimeType;
  const data = buf.toString("base64");
  if (mimeType !== media.mimeType) {
    console.log(`[chat] image mimeType corrected: ${media.mimeType} → ${mimeType}`);
  }

  if (!modelSupportsVision(chatModel.meta)) {
    const fallbackReason = getChatModelVisionFallbackReason(chatModel.meta);
    const visionModel = await resolveConfiguredModel(accountId, conversationId, "vision");
    if (visionModel) {
      if (!modelSupportsVision(visionModel.meta)) {
        content.push(createImagePlaceholder("no_vision_model_configured"));
        imagePromptReplacementText = "[图片原始文件已保存；vision 模型未声明支持图片输入。]";
        console.warn(
          `[vision] configured vision model does not support image input: ${visionModel.modelId}`,
        );
      } else {
        try {
          const visualContext = await describeImageWithVisionModel({
            model: visionModel.model,
            modelId: visionModel.modelId,
            imageData: data,
            mimeType,
            imageBytes: buf.byteLength,
            fallbackReason,
          });
          visualContexts.push(visualContext);
          content.push(formatVisualContextForPrompt(visualContext));
          imagePromptReplacementText = "[图片原始文件已保存；图片内容见上方 visual_context。]";
        } catch (error) {
          const reason = getVisionFailureReason(error);
          console.warn("[vision] describe image failed, using placeholder:", error);
          content.push(createImagePlaceholder(reason));
          imagePromptReplacementText = "[图片原始文件已保存；图片内容识别失败。]";
        }
      }
    } else {
      content.push(createImagePlaceholder("no_vision_model_configured"));
      imagePromptReplacementText = "[图片原始文件已保存；未配置 vision 模型。]";
      console.warn("[vision] no vision model configured; image will be replaced with placeholder");
    }
  }

  content.push({
    type: MESSAGE_CONTENT_TYPE.IMAGE,
    data,
    mimeType: mimeType as ImageContent["mimeType"],
    ...(media.assetId ? { assetId: media.assetId } : {}),
    ...(imagePromptReplacementText ? { promptReplacementText: imagePromptReplacementText } : {}),
  });

  return { content, visualContexts };
}

export async function describeImageWithVisionModel(
  input: DescribeImageInput,
): Promise<VisualContext> {
  const startedAt = Date.now();
  return withSpan(
    "vision.describe",
    {
      model: input.modelId,
      imageMimeType: input.mimeType,
      imageBytes: input.imageBytes,
      ...(input.fallbackReason ? { fallbackReason: input.fallbackReason } : {}),
    },
    async (span) => {
      console.log(
        `[vision] describe start model=${input.modelId} imageBytes=${input.imageBytes} timeoutMs=${VISION_TIMEOUT_MS}`,
      );

      const systemPrompt = getPromptAssets().get(PROMPT_PROFILES.vision_describe.systemPromptKey);
      const prompt = buildVisionPrompt();
      let result: Awaited<ReturnType<typeof generateObject<typeof VISION_OUTPUT_SCHEMA>>>;
      try {
        result = await generateObject({
          model: input.model,
          system: systemPrompt,
          schema: VISION_OUTPUT_SCHEMA,
          schemaName: "VisualContext",
          schemaDescription: "纯图片识别结果，只包含图片中可见事实。",
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: prompt },
                { type: "image", image: input.imageData, mediaType: input.mimeType },
              ],
            },
          ],
          maxOutputTokens: VISION_MAX_OUTPUT_TOKENS,
          abortSignal: AbortSignal.timeout(VISION_TIMEOUT_MS),
          async experimental_repairText({ text }) {
            return extractJsonBlock(text);
          },
        });
      } catch (error) {
        const partialText = getErrorText(error);
        const recovered = partialText
          ? recoverVisualContextFromPartialText(partialText, input.modelId)
          : undefined;

        if (!recovered?.summary) {
          throw error;
        }

        const attributes: Record<string, string | number | boolean> = {
          latencyMs: Date.now() - startedAt,
          fallbackReason: "vision_parse_failed",
          promptSnapshot: sanitize(prompt),
          completionSnapshot: sanitize(JSON.stringify(recovered, null, 2)),
        };
        if (partialText) {
          attributes.rawCompletionSnapshot = sanitize(truncateText(partialText, 2000));
        }
        span.addAttributes(attributes);

        console.warn("[vision] recovered partial vision response after parse failure");
        return recovered;
      }

      const raw = result.object;
      if (!raw.summary.trim()) {
        throw new Error("vision_empty_result");
      }

      const context = normalizeVisualContext(raw, input.modelId);

      if (!context.summary) {
        throw new Error("vision_empty_result");
      }

      span.addAttributes({
        latencyMs: Date.now() - startedAt,
        inputTokens: result.usage.inputTokens ?? 0,
        outputTokens: result.usage.outputTokens ?? 0,
        promptSnapshot: sanitize(prompt),
        completionSnapshot: sanitize(JSON.stringify(context, null, 2)),
        ...(context.fallbackReason ? { fallbackReason: context.fallbackReason } : {}),
      });

      return context;
    },
  );
}
