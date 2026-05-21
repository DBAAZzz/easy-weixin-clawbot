import { generateObject } from "ai";
import { z } from "zod";
import { sanitize, withSpan } from "@clawbot/observability";
import type {
  LanguageModel,
  TextContent,
  VisionFallbackReason,
  VisualContext,
} from "./llm/types.js";
import { getPromptAssets } from "./prompts/port.js";
import { PROMPT_PROFILES } from "./prompts/profiles.js";

const VISION_TIMEOUT_MS = 120_000;
const VISION_MAX_OUTPUT_TOKENS = 1200;
const MAX_CONTEXT_CHARS = 1200;

const VISION_OUTPUT_SCHEMA = z.object({
  summary: z.string().describe("一句话概括图片中可见内容"),
  ocr_text: z.array(z.string()).default([]).describe("图片中识别出的文字，按阅读顺序排列"),
  objects: z.array(z.string()).default([]).describe("图片中清晰可见的主要对象、人物、界面元素或环境元素"),
});

export interface DescribeImageInput {
  model: LanguageModel;
  modelId: string;
  imageData: string;
  mimeType: string;
  imageBytes: number;
  fallbackReason?: VisionFallbackReason;
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
  return value.map((item) => String(item).trim()).filter(Boolean);
}

function extractJsonText(text: string): string | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)\s*```/i.exec(text);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) {
    return null;
  }
  return text.slice(start, end + 1);
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
    summary,
    ocrText: asStringArray(raw.ocr_text ?? raw.ocrText),
    objects: asStringArray(raw.objects),
    ...(fallbackReason ? { fallbackReason } : {}),
  };
}

function buildVisionPrompt(): string {
  return "请只识别这张图片中可见的事实，并按 schema 输出。";
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

  return { type: "text", text: truncateText(lines.join("\n"), maxChars) };
}

export function createImagePlaceholder(reason: VisionFallbackReason): TextContent {
  const text =
    reason === "no_vision_model_configured"
      ? "[图片：当前 chat 模型不支持视觉输入，且未配置可用的 vision 模型]"
      : "[图片：当前 chat 模型不支持视觉输入，且图片识别失败]";
  return { type: "text", text };
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
      const result = await generateObject({
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
          return extractJsonText(text);
        },
      });

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
