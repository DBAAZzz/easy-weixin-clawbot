import {
  startTransition,
  useDeferredValue,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from "react";
import type {
  MarkdownSource,
  SkillInfo,
  SkillLocalRunCheck,
  SkillProvisionLog,
  SkillProvisionPlan,
} from "@clawbot/shared";
import { Badge } from "../components/ui/badge.js";
import { Button } from "../components/ui/button.js";
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
} from "../components/ui/dialog.js";
import { Input } from "../components/ui/input.js";
import { ActivityIcon, PuzzleIcon, SearchIcon, UploadIcon } from "../components/ui/icons.js";
import { useQuery } from "@tanstack/react-query";
import { useSkills } from "../hooks/useSkills.js";
import { toast } from "../components/ui/sonner.js";
import { fetchSkillSource } from "@/api/skills.js";
import { queryKeys } from "../lib/query-keys.js";
import { cn } from "../lib/cn.js";
import { formatCount } from "../lib/format.js";
import { isAutoProvisionableRuntime } from "./skills-runtime-labels.js";

function formatActivationLabel(activation: SkillInfo["activation"]) {
  return activation === "always" ? "Always-On" : "On-Demand";
}

function formatOriginLabel(origin: SkillInfo["origin"]) {
  return origin === "builtin" ? "内置" : "用户层";
}

function runCheckTone(status: "ok" | "fail" | "info"): "online" | "error" | "muted" {
  if (status === "ok") return "online";
  if (status === "fail") return "error";
  return "muted";
}

export function notifySkillInstallSuccess(skillName: string, notify: (message: string) => void) {
  notify(`技能 "${skillName}" 安装成功`);
}

export type SkillDetailTab = "markdown" | "runtime";
type MarkdownBlock =
  | { type: "heading"; level: 1 | 2 | 3; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "blockquote"; text: string }
  | { type: "code"; language: string | null; code: string };

function SkillAvatar(props: { origin: SkillInfo["origin"] }) {
  return (
    <span
      className={cn(
        "flex size-10 shrink-0 items-center justify-center rounded-lg border bg-frost-92",
        props.origin === "builtin"
          ? "border-line text-ink"
          : "border-accent-border text-accent-strong",
      )}
    >
      <PuzzleIcon className="size-[18px]" />
    </span>
  );
}

function SkillToggle(props: {
  enabled: boolean;
  busy: boolean;
  onToggle: () => void | Promise<void>;
}) {
  return (
    <button
      type="button"
      disabled={props.busy}
      aria-label={props.enabled ? "停用 skill" : "启用 skill"}
      aria-pressed={props.enabled}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        void props.onToggle();
      }}
      className={cn(
        "relative inline-flex h-8 w-[50px] shrink-0 items-center rounded-full border p-1 transition duration-200 ease-expo disabled:cursor-not-allowed disabled:opacity-60",
        props.enabled
          ? "border-toggle-border bg-accent"
          : "border-line-strong bg-toggle-off-strong",
      )}
    >
      <span
        className={cn(
          "size-6 rounded-full bg-white shadow-float transition duration-200 ease-expo",
          props.enabled ? "translate-x-[18px]" : "translate-x-0",
        )}
      />
    </button>
  );
}

function SkillCard(props: {
  skill: SkillInfo;
  index: number;
  busy: boolean;
  onOpen: () => void;
  onToggle: () => void | Promise<void>;
}) {
  const metadata = [
    `版本 ${props.skill.version}`,
    formatActivationLabel(props.skill.activation),
    formatOriginLabel(props.skill.origin),
  ];

  return (
    <div
      role="button"
      tabIndex={0}
      aria-haspopup="dialog"
      aria-label={`查看 ${props.skill.name} 详情`}
      onClick={props.onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          props.onOpen();
        }
      }}
      className="reveal-up group flex min-h-[108px] cursor-pointer items-center gap-3 rounded-lg border border-card-line bg-card-bg px-3.5 py-3.5 transition duration-200 ease-expo hover:-translate-y-0.5 hover:border-notice-success-border hover:bg-card-hover focus-visible:outline-none focus-visible:shadow-focus-accent md:px-4"
      style={{ animationDelay: `${props.index * 40}ms` }}
    >
      <SkillAvatar origin={props.skill.origin} />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-lg font-semibold tracking-title text-ink">{props.skill.name}</h3>
          <Badge
            tone="muted"
            className="border-transparent bg-accent-mist px-2 py-1 text-2xs tracking-tag text-accent-strong"
          >
            {formatActivationLabel(props.skill.activation)}
          </Badge>
        </div>

        <p className="mt-1 truncate text-base leading-5 text-muted-strong">{props.skill.summary}</p>

        <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
          {metadata.map((item, index) => (
            <span key={item} className="flex items-center gap-2">
              {index > 0 ? <span className="size-1 rounded-full bg-line-strong" /> : null}
              <span>{item}</span>
            </span>
          ))}
        </div>
      </div>

      <div className="flex shrink-0 flex-col items-end gap-1.5">
        <SkillToggle enabled={props.skill.enabled} busy={props.busy} onToggle={props.onToggle} />
        <span className="text-xs font-medium text-muted">
          {props.skill.enabled ? "已启用" : "已停用"}
        </span>
      </div>
    </div>
  );
}

function stripMarkdownFrontmatter(markdown: string) {
  return markdown.replace(/^---\n[\s\S]*?\n---\n*/u, "").trim();
}

function isMarkdownBlockBoundary(line: string) {
  const trimmed = line.trim();
  return (
    trimmed.length === 0 ||
    trimmed.startsWith("```") ||
    /^(#{1,6})\s+/.test(trimmed) ||
    /^[-*]\s+/.test(trimmed) ||
    /^\d+\.\s+/.test(trimmed) ||
    trimmed.startsWith(">")
  );
}

function parseMarkdownBlocks(markdown: string): MarkdownBlock[] {
  const normalized = stripMarkdownFrontmatter(markdown).replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];

  const lines = normalized.split("\n");
  const blocks: MarkdownBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const currentLine = lines[index]!;
    const trimmed = currentLine.trim();

    if (!trimmed) {
      index += 1;
      continue;
    }

    const codeMatch = /^```([a-zA-Z0-9_-]+)?$/.exec(trimmed);
    if (codeMatch) {
      index += 1;
      const codeLines: string[] = [];
      while (index < lines.length && !/^```$/.test(lines[index]!.trim())) {
        codeLines.push(lines[index]!);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push({
        type: "code",
        language: codeMatch[1] ?? null,
        code: codeLines.join("\n").trimEnd(),
      });
      continue;
    }

    const headingMatch = /^(#{1,3})\s+(.*)$/.exec(trimmed);
    if (headingMatch) {
      blocks.push({
        type: "heading",
        level: headingMatch[1].length as 1 | 2 | 3,
        text: headingMatch[2].trim(),
      });
      index += 1;
      continue;
    }

    const orderedList = /^\d+\.\s+/.test(trimmed);
    const unorderedList = /^[-*]\s+/.test(trimmed);
    if (orderedList || unorderedList) {
      const items: string[] = [];
      while (index < lines.length) {
        const listLine = lines[index]!.trim();
        if (!listLine) break;
        if (orderedList && /^\d+\.\s+/.test(listLine)) {
          items.push(listLine.replace(/^\d+\.\s+/u, ""));
          index += 1;
          continue;
        }
        if (unorderedList && /^[-*]\s+/.test(listLine)) {
          items.push(listLine.replace(/^[-*]\s+/u, ""));
          index += 1;
          continue;
        }
        break;
      }
      blocks.push({ type: "list", ordered: orderedList, items });
      continue;
    }

    if (trimmed.startsWith(">")) {
      const quoteLines: string[] = [];
      while (index < lines.length && lines[index]!.trim().startsWith(">")) {
        quoteLines.push(lines[index]!.trim().replace(/^>\s?/u, ""));
        index += 1;
      }
      blocks.push({ type: "blockquote", text: quoteLines.join(" ") });
      continue;
    }

    const paragraphLines = [trimmed];
    index += 1;
    while (index < lines.length && !isMarkdownBlockBoundary(lines[index]!)) {
      paragraphLines.push(lines[index]!.trim());
      index += 1;
    }
    blocks.push({ type: "paragraph", text: paragraphLines.join(" ") });
  }

  return blocks;
}

function renderInlineMarkdown(text: string, keyPrefix: string): ReactNode[] {
  const tokens = text
    .split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\)|\*[^*]+\*)/u)
    .filter(Boolean);

  return tokens.map((token, index) => {
    const key = `${keyPrefix}-${index}`;

    if (token.startsWith("**") && token.endsWith("**")) {
      return (
        <strong key={key} className="font-semibold text-ink">
          {token.slice(2, -2)}
        </strong>
      );
    }

    if (token.startsWith("*") && token.endsWith("*")) {
      return (
        <em key={key} className="italic text-ink-soft">
          {token.slice(1, -1)}
        </em>
      );
    }

    if (token.startsWith("`") && token.endsWith("`")) {
      return (
        <code
          key={key}
          className="rounded-xs bg-accent-mist px-1.5 py-0.5 font-mono text-sm text-accent-strong"
        >
          {token.slice(1, -1)}
        </code>
      );
    }

    const linkMatch = /^\[([^\]]+)\]\(([^)]+)\)$/u.exec(token);
    if (linkMatch) {
      return (
        <a
          key={key}
          href={linkMatch[2]}
          target="_blank"
          rel="noreferrer"
          className="underline decoration-line underline-offset-4 transition hover:text-accent-strong"
        >
          {linkMatch[1]}
        </a>
      );
    }

    return <span key={key}>{token}</span>;
  });
}

function ExpandableSummary(props: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const summary = props.text.trim();
  const canExpand = summary.length > 60;

  if (!summary) {
    return null;
  }

  return (
    <div className="mt-4 max-w-3xl">
      <p
        className={cn(
          "text-lg leading-7 text-muted-strong",
          canExpand && !expanded && "line-clamp-2",
        )}
      >
        {summary}
      </p>
      {canExpand ? (
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          className="mt-2 text-sm font-medium text-accent-strong transition hover:text-accent"
        >
          {expanded ? "收起" : "...更多"}
        </button>
      ) : null}
    </div>
  );
}

function CompactMetaStrip(props: {
  items: Array<{ label: string; value: string; mono?: boolean }>;
}) {
  return (
    <div className="mt-5 overflow-hidden rounded-panel border border-line bg-white/72">
      <dl className="grid gap-0 md:grid-cols-2 xl:grid-cols-4">
        {props.items.map((item, index) => (
          <div
            key={item.label}
            className={cn(
              "px-4 py-3.5",
              index > 0 && "border-t border-line",
              index % 2 === 1 && "md:border-l",
              index < 2 && "md:border-t-0",
              index > 0 && "xl:border-l",
              index > 1 && "xl:border-t-0",
            )}
          >
            <dt className="text-xs tracking-label text-muted">{item.label}</dt>
            <dd
              className={cn(
                "mt-1.5 text-md font-medium text-ink",
                item.mono && "font-mono text-sm tracking-mono text-ink-soft",
              )}
            >
              {item.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function DetailTabButton(props: {
  tab: SkillDetailTab;
  activeTab: SkillDetailTab;
  label: string;
  onSelect: (tab: SkillDetailTab) => void;
}) {
  const selected = props.activeTab === props.tab;

  return (
    <button
      id={`skill-tab-${props.tab}`}
      type="button"
      role="tab"
      aria-selected={selected}
      aria-controls={`skill-panel-${props.tab}`}
      onClick={() => props.onSelect(props.tab)}
      className={cn(
        "inline-flex items-center border-b-2 px-0 pb-3 pt-1 text-base font-medium tracking-body transition duration-200 ease-expo",
        selected ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink",
      )}
    >
      <span>{props.label}</span>
    </button>
  );
}

function buildEnvironmentSnapshot(options: {
  dependencies: string[];
  scripts: string[];
  installer?: string;
  createEnv?: boolean;
  commands: string[];
}) {
  return JSON.stringify(
    {
      dependencies: options.dependencies,
      scripts: options.scripts,
      installer: options.installer ?? "unknown",
      createEnv: options.createEnv ?? false,
      commands: options.commands,
    },
    null,
    2,
  );
}

function SkillMarkdownDocument(props: { markdown: string }) {
  const blocks = parseMarkdownBlocks(props.markdown);

  if (blocks.length === 0) {
    return <p className="text-base leading-7 text-muted">暂无文档正文</p>;
  }

  return (
    <article className="space-y-4">
      {blocks.map((block, index) => {
        if (block.type === "heading") {
          if (block.level === 1) {
            return (
              <h4
                key={`heading-${index}`}
                className="text-4xl font-semibold tracking-title text-ink"
              >
                {renderInlineMarkdown(block.text, `heading-${index}`)}
              </h4>
            );
          }

          if (block.level === 2) {
            return (
              <h5
                key={`heading-${index}`}
                className="pt-2 text-2xl font-semibold tracking-title text-ink"
              >
                {renderInlineMarkdown(block.text, `heading-${index}`)}
              </h5>
            );
          }

          return (
            <h6
              key={`heading-${index}`}
              className="pt-1 text-xl font-semibold tracking-title text-ink-soft"
            >
              {renderInlineMarkdown(block.text, `heading-${index}`)}
            </h6>
          );
        }

        if (block.type === "paragraph") {
          return (
            <p key={`paragraph-${index}`} className="text-lg leading-7 text-ink-soft">
              {renderInlineMarkdown(block.text, `paragraph-${index}`)}
            </p>
          );
        }

        if (block.type === "blockquote") {
          return (
            <blockquote
              key={`blockquote-${index}`}
              className="border-l-2 border-accent pl-4 text-base leading-7 text-muted-strong"
            >
              {renderInlineMarkdown(block.text, `blockquote-${index}`)}
            </blockquote>
          );
        }

        if (block.type === "list") {
          const ListTag = block.ordered ? "ol" : "ul";
          return (
            <ListTag
              key={`list-${index}`}
              className={cn(
                "space-y-2 pl-5 text-base leading-7 text-ink-soft marker:text-accent-strong",
                block.ordered ? "list-decimal" : "list-disc",
              )}
            >
              {block.items.map((item, itemIndex) => (
                <li key={`list-${index}-${itemIndex}`}>
                  {renderInlineMarkdown(item, `list-${index}-${itemIndex}`)}
                </li>
              ))}
            </ListTag>
          );
        }

        return (
          <div
            key={`code-${index}`}
            className="overflow-hidden rounded-section border border-line bg-detail-bg"
          >
            {block.language ? (
              <div className="border-b border-line px-4 py-2 text-sm uppercase tracking-label text-muted">
                {block.language}
              </div>
            ) : null}
            <pre className="overflow-x-auto px-4 py-4 text-sm leading-6 text-ink-soft">
              <code>{block.code}</code>
            </pre>
          </div>
        );
      })}
    </article>
  );
}

export function SkillDetailModal(props: {
  skill: SkillInfo;
  source: { data: MarkdownSource | null; loading: boolean; error: string | null };
  activeTab: SkillDetailTab;
  preflightBusy: boolean;
  provisionBusy: boolean;
  preflight: SkillProvisionPlan | null;
  preflightError: string | null;
  logs: SkillProvisionLog[];
  onTabChange: (tab: SkillDetailTab) => void;
  onClose: () => void;
  onPreflight: () => void | Promise<void>;
  onProvision: () => void | Promise<void>;
  onReprovision: () => void | Promise<void>;
}) {
  const overviewItems = [
    {
      label: "版本",
      value: props.skill.version,
    },
    {
      label: "激活方式",
      value: formatActivationLabel(props.skill.activation),
    },
    {
      label: "来源",
      value: formatOriginLabel(props.skill.origin),
    },
    {
      label: "状态",
      value: props.skill.enabled ? "已启用" : "已停用",
    },
  ];
  const dependencies =
    props.preflight?.dependencies.map((dependency) => dependency.name) ??
    props.skill.dependencyNames ??
    [];
  const scripts = props.skill.scriptSet ?? [];
  const markdownBody = props.source.data?.markdown ?? "";
  const runtimeMessage =
    props.skill.runtimeKind === "knowledge-only" || !props.skill.runtimeKind
      ? "该 Skill 仅提供 Markdown 知识内容，不需要独立运行时。"
      : props.skill.runtimeKind === "manual-needed"
        ? "该 Skill 需要人工确认运行方式。"
        : null;
  const environmentSnapshot = buildEnvironmentSnapshot({
    dependencies,
    scripts,
    installer: props.preflight?.installer,
    createEnv: props.preflight?.createEnv,
    commands: props.preflight?.commandPreview ?? [],
  });
  const primaryInstallAction =
    props.skill.provisionStatus === "ready" ||
    props.skill.provisionStatus === "failed" ||
    Boolean(props.skill.installedAt)
      ? props.onReprovision
      : props.onProvision;

  return (
    <Dialog open onOpenChange={(open) => !open && props.onClose()}>
      <DialogPortal>
        <DialogOverlay />
        <DialogContent className="max-w-4xl rounded-section bg-glass-92">
          <DialogClose
            label="关闭 skill 详情"
            className="absolute right-5 top-5 z-20 size-9 border-transparent bg-transparent text-muted hover:border-transparent hover:bg-transparent hover:text-ink"
          />

          <DialogHeader className="py-5">
            <div className="pr-10">
              <DialogTitle className="truncate">{props.skill.name}</DialogTitle>
              <p className="mt-2 text-sm text-muted">
                当前状态：
                <span className="font-medium text-ink">
                  {props.skill.enabled ? " 已启用" : " 已停用"}
                </span>
                {props.skill.provisionError ? (
                  <span className="text-red-700"> · 最近一次安装失败</span>
                ) : null}
              </p>
              <ExpandableSummary text={props.skill.summary} />
            </div>

            <CompactMetaStrip items={overviewItems} />
          </DialogHeader>

          <DialogBody className="py-6">
            <div
              role="tablist"
              aria-label="Skill 详情视图"
              className="flex flex-wrap items-center gap-6 border-b border-line"
            >
              <DetailTabButton
                tab="markdown"
                activeTab={props.activeTab}
                label="文档"
                onSelect={props.onTabChange}
              />
              <DetailTabButton
                tab="runtime"
                activeTab={props.activeTab}
                label="环境配置"
                onSelect={props.onTabChange}
              />
            </div>

            <div className="pt-6">
              {props.activeTab === "markdown" ? (
                <div id="skill-panel-markdown" role="tabpanel" aria-labelledby="skill-tab-markdown">
                  {props.source.loading ? (
                    <div className="space-y-3">
                      <div className="ui-skeleton h-5 rounded-lg" />
                      <div className="ui-skeleton h-4 rounded-lg" />
                      <div className="ui-skeleton h-4 rounded-lg" />
                      <div className="ui-skeleton h-4 rounded-lg" />
                      <div className="ui-skeleton h-28 rounded-section" />
                    </div>
                  ) : props.source.error ? (
                    <div className="rounded-section border border-notice-error-border bg-notice-error-bg px-4 py-3 text-base leading-6 text-red-700">
                      加载源码失败：{props.source.error}
                    </div>
                  ) : (
                    <div className="rounded-panel bg-detail-bg px-6 py-7 md:px-7 md:py-8">
                      <SkillMarkdownDocument markdown={markdownBody} />
                    </div>
                  )}
                </div>
              ) : (
                <div id="skill-panel-runtime" role="tabpanel" aria-labelledby="skill-tab-runtime">
                  <div className="space-y-6">
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      {!runtimeMessage ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={props.preflightBusy || props.provisionBusy}
                          onClick={() => void props.onPreflight()}
                        >
                          {props.preflightBusy ? "检测中…" : "重新检测"}
                        </Button>
                      ) : null}
                      {!runtimeMessage ? (
                        <Button
                          size="sm"
                          disabled={props.preflightBusy || props.provisionBusy}
                          onClick={() => void primaryInstallAction()}
                        >
                          {props.provisionBusy ? "安装中…" : "安装"}
                        </Button>
                      ) : null}
                    </div>

                    <div className="rounded-panel bg-detail-bg px-6 py-6 md:px-7 md:py-7">
                      {runtimeMessage ? (
                        <p className="text-base leading-7 text-muted-strong">{runtimeMessage}</p>
                      ) : props.preflightBusy && !props.preflight ? (
                        <div className="space-y-3">
                          <div className="ui-skeleton h-4 rounded-lg" />
                          <div className="ui-skeleton h-4 rounded-lg" />
                          <div className="ui-skeleton h-28 rounded-panel" />
                        </div>
                      ) : (
                        <div className="space-y-6">
                          {props.preflightError ? (
                            <p className="text-sm leading-6 text-red-700">
                              环境检测失败：{props.preflightError}
                            </p>
                          ) : null}

                          {props.skill.provisionError ? (
                            <p className="text-sm leading-6 text-red-700">
                              最近一次安装失败：{props.skill.provisionError}
                            </p>
                          ) : null}

                          <div>
                            <p className="text-xs tracking-label text-muted">环境数据</p>
                            <pre className="mt-3 overflow-x-auto rounded-panel border border-line bg-white/78 px-4 py-4 text-sm leading-6 text-ink-soft">
                              {environmentSnapshot}
                            </pre>
                          </div>

                          <div className="border-t border-line pt-6">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <p className="text-xs tracking-label text-muted">安装日志</p>
                              <p className="text-sm text-muted">
                                {formatCount(props.logs.length)} 条
                              </p>
                            </div>
                            <pre className="mt-3 max-h-52 overflow-auto rounded-panel border border-line bg-white/78 px-4 py-4 text-sm leading-6 text-ink-soft">
                              {props.logs.length > 0
                                ? props.logs
                                    .map((log) => `[${log.level}] ${log.message}`)
                                    .join("\n")
                                : "暂无日志"}
                            </pre>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </DialogBody>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
}

export function SkillsPage() {
  const {
    skills,
    loading,
    error,
    refresh,
    enable,
    disable,
    uploadFile,
    preflight,
    reprovision,
    streamProvision,
  } = useSkills();
  const [query, setQuery] = useState("");
  const [activeSkillName, setActiveSkillName] = useState<string | null>(null);
  const [activeDetailTab, setActiveDetailTab] = useState<SkillDetailTab>("markdown");
  const [notice, setNotice] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [pendingToggleName, setPendingToggleName] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadCheck, setUploadCheck] = useState<SkillLocalRunCheck | null>(null);
  const [preflightBusy, setPreflightBusy] = useState(false);
  const [provisionBusy, setProvisionBusy] = useState(false);
  const [preflightPlan, setPreflightPlan] = useState<SkillProvisionPlan | null>(null);
  const [preflightError, setPreflightError] = useState<string | null>(null);
  const [provisionLogs, setProvisionLogs] = useState<SkillProvisionLog[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const deferredQuery = useDeferredValue(query);
  const normalizedQuery = deferredQuery.trim().toLowerCase();
  const filteredSkills = skills.filter((skill) => {
    if (!normalizedQuery) return true;

    return [skill.name, skill.summary, skill.activation, skill.origin, skill.author ?? ""].some(
      (value) => value.toLowerCase().includes(normalizedQuery),
    );
  });
  const activeSkill = skills.find((skill) => skill.name === activeSkillName) ?? null;
  const sourceQuery = useQuery({
    queryKey: queryKeys.skillSource(activeSkillName ?? ""),
    queryFn: () => fetchSkillSource(activeSkillName!),
    enabled: Boolean(activeSkillName),
  });
  const source = {
    data: sourceQuery.data ?? null,
    loading: Boolean(activeSkillName) && sourceQuery.isPending,
    error:
      sourceQuery.error instanceof Error
        ? sourceQuery.error.message
        : sourceQuery.error
          ? String(sourceQuery.error)
          : null,
  };

  useEffect(() => {
    if (!activeSkillName) return;

    if (!skills.some((skill) => skill.name === activeSkillName)) {
      setActiveSkillName(null);
    }
  }, [activeSkillName, skills]);

  useEffect(() => {
    if (!activeSkillName) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setActiveSkillName(null);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeSkillName]);

  useEffect(() => {
    setPreflightBusy(false);
    setPreflightPlan(null);
    setPreflightError(null);
    setProvisionLogs([]);
  }, [activeSkillName]);

  useEffect(() => {
    if (!activeSkillName) return;
    setActiveDetailTab("markdown");
  }, [activeSkillName]);

  useEffect(() => {
    if (activeDetailTab !== "runtime" || !activeSkill) {
      return;
    }

    if (!isAutoProvisionableRuntime(activeSkill.runtimeKind)) {
      return;
    }

    if (preflightBusy || preflightPlan || preflightError) {
      return;
    }

    void handlePreflight(activeSkill);
  }, [activeDetailTab, activeSkill, preflightBusy, preflightPlan, preflightError]);

  const enabledCount = skills.filter((skill) => skill.enabled).length;
  const alwaysOnCount = skills.filter((skill) => skill.activation === "always").length;
  const onDemandCount = skills.length - alwaysOnCount;

  async function handleRefresh() {
    setNotice(null);
    setMutationError(null);
    setUploadCheck(null);
    refresh();
  }

  async function handleFileUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    // Reset the input so the same file can be re-selected
    event.target.value = "";

    setNotice(null);
    setMutationError(null);
    setUploadCheck(null);
    setUploading(true);

    try {
      const result = await uploadFile(file);
      notifySkillInstallSuccess(result.name, toast.success);
      setUploadCheck(result.localRunCheck ?? null);
    } catch (reason) {
      setMutationError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setUploading(false);
    }
  }

  async function handlePreflight(skill: SkillInfo) {
    setPreflightBusy(true);
    setPreflightError(null);
    setPreflightPlan(null);
    try {
      const plan = await preflight(skill.name);
      setPreflightPlan(plan);
    } catch (reason) {
      setPreflightError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setPreflightBusy(false);
    }
  }

  async function handleProvision(skill: SkillInfo) {
    setProvisionBusy(true);
    setPreflightError(null);
    setProvisionLogs([]);
    setMutationError(null);

    try {
      await streamProvision(skill.name, {
        onLog: (log) => setProvisionLogs((prev) => [...prev, log]),
        onError: (payload) => {
          setMutationError(payload.error);
        },
      });
      await handleRefresh();
      setNotice(`技能 "${skill.name}" 运行时安装完成`);
    } catch (reason) {
      setMutationError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setProvisionBusy(false);
    }
  }

  async function handleReprovision(skill: SkillInfo) {
    setProvisionBusy(true);
    setMutationError(null);
    setPreflightError(null);
    setProvisionLogs([]);

    try {
      const result = await reprovision(skill.name);
      setProvisionLogs(result.logs);
      setNotice(`技能 "${skill.name}" 已完成重装`);
      await handleRefresh();
    } catch (reason) {
      setMutationError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setProvisionBusy(false);
    }
  }

  async function handleToggle(skill: SkillInfo) {
    setNotice(null);
    setMutationError(null);
    setPendingToggleName(skill.name);

    try {
      const result = skill.enabled ? await disable(skill.name) : await enable(skill.name);
      setNotice(`${result.name} 已${result.enabled ? "启用" : "停用"}`);
    } catch (reason) {
      setMutationError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setPendingToggleName(null);
    }
  }

  return (
    <>
      <div className="space-y-5">
        <section className="space-y-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs uppercase tracking-label-xl text-muted">Skills</p>
              <h2 className="mt-1.5 text-6xl text-ink">已安装技能</h2>
            </div>

            <div className="flex items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept=".zip,.md"
                className="hidden"
                onChange={(event) => void handleFileUpload(event)}
              />
              <Button
                size="sm"
                variant="outline"
                disabled={uploading}
                onClick={() => fileInputRef.current?.click()}
              >
                <UploadIcon className="size-4" />
                {uploading ? "上传中…" : "上传技能"}
              </Button>
              <Button size="sm" onClick={() => void handleRefresh()}>
                <ActivityIcon className="size-4" />
                刷新列表
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="relative w-full xl:max-w-[360px]">
              <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索 skill 名称、摘要或来源"
                className="h-10 rounded-lg pl-10"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
              <Badge tone="muted">已安装 {formatCount(skills.length)}</Badge>
              <Badge tone="muted">启用 {formatCount(enabledCount)}</Badge>
              <Badge tone="muted">Always-On {formatCount(alwaysOnCount)}</Badge>
              <Badge tone="muted">On-Demand {formatCount(onDemandCount)}</Badge>
            </div>
          </div>
        </section>

        {error ? (
          <div className="rounded-section border border-notice-error-border bg-notice-error-bg px-4 py-3 text-base leading-6 text-red-700">
            加载 skill 列表失败：{error}
          </div>
        ) : null}

        {mutationError ? (
          <div className="rounded-section border border-notice-error-border bg-notice-error-bg px-4 py-3 text-base leading-6 text-red-700">
            操作失败：{mutationError}
          </div>
        ) : null}

        {notice ? (
          <div className="rounded-section border border-notice-success-border bg-notice-success-bg px-4 py-3 text-base leading-6 text-accent-strong">
            {notice}
          </div>
        ) : null}

        {uploadCheck ? (
          <div className="rounded-section border border-line bg-detail-bg px-4 py-3">
            <div className="flex items-center gap-2">
              <Badge tone={uploadCheck.canRunNow ? "online" : "warning"}>
                本地可运行检查：{uploadCheck.canRunNow ? "通过" : "未通过"}
              </Badge>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {uploadCheck.checks.map((check, index) => (
                <Badge key={`${check.message}-${index}`} tone={runCheckTone(check.status)}>
                  {check.message}
                </Badge>
              ))}
            </div>
          </div>
        ) : null}

        {loading ? (
          <section className="grid gap-4 xl:grid-cols-2">
            {Array.from({ length: 6 }).map((_, index) => (
              <div
                key={index}
                className="overflow-hidden rounded-lg border border-line bg-glass-80 px-3.5 py-3.5 md:px-4"
              >
                <div className="flex items-center gap-3">
                  <div className="ui-skeleton size-10 rounded-lg" />
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="ui-skeleton h-5 rounded-lg" />
                    <div className="ui-skeleton h-4 rounded-lg" />
                    <div className="ui-skeleton h-3 w-2/3 rounded-full" />
                  </div>
                  <div className="ui-skeleton h-8 w-[50px] rounded-full" />
                </div>
              </div>
            ))}
          </section>
        ) : null}

        {!loading && filteredSkills.length === 0 ? (
          <section className="rounded-dialog border border-dashed border-line bg-glass-48 px-5 py-10 text-center">
            <p className="text-xl font-medium text-ink">没有匹配到 skill</p>
          </section>
        ) : null}

        {!loading && filteredSkills.length > 0 ? (
          <section className="space-y-3">
            <div className="flex items-center gap-2 text-sm text-muted">
              <PuzzleIcon className="size-4 text-muted-strong" />
              <span>当前展示 {formatCount(filteredSkills.length)} 个已安装 skill</span>
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              {filteredSkills.map((skill, index) => (
                <SkillCard
                  key={skill.name}
                  skill={skill}
                  index={index}
                  busy={pendingToggleName === skill.name}
                  onOpen={() =>
                    startTransition(() => {
                      setActiveSkillName(skill.name);
                      setActiveDetailTab("markdown");
                    })
                  }
                  onToggle={() => handleToggle(skill)}
                />
              ))}
            </div>
          </section>
        ) : null}
      </div>

      {activeSkill ? (
        <SkillDetailModal
          skill={activeSkill}
          source={source}
          activeTab={activeDetailTab}
          preflightBusy={preflightBusy}
          provisionBusy={provisionBusy}
          preflight={preflightPlan}
          preflightError={preflightError}
          logs={provisionLogs}
          onTabChange={setActiveDetailTab}
          onClose={() => {
            setActiveSkillName(null);
            setActiveDetailTab("markdown");
          }}
          onPreflight={() => handlePreflight(activeSkill)}
          onProvision={() => handleProvision(activeSkill)}
          onReprovision={() => handleReprovision(activeSkill)}
        />
      ) : null}
    </>
  );
}
