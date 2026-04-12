import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Badge } from "../components/ui/badge.js";
import { Button } from "../components/ui/button.js";
import { Input } from "../components/ui/input.js";
import { CardOverflowMenu, CardToggle, IconTag, MetricGrid } from "../components/ui/admin-card.js";
import {
  WebhookIcon,
  CopyIcon,
  TrashIcon,
  RefreshIcon,
  PlusIcon,
  KeyIcon,
  CheckIcon,
  XIcon,
  ActivityIcon,
  ClockIcon,
  LayersIcon,
  StackIcon,
} from "../components/ui/icons.js";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchWebhookTokens,
  createWebhookToken,
  toggleWebhookToken,
  rotateWebhookToken,
  deleteWebhookToken,
  testWebhookToken,
} from "@/api/webhooks.js";
import { queryKeys } from "../lib/query-keys.js";
import { useAccounts } from "../hooks/useAccounts.js";
import type { WebhookMessageType, WebhookTokenInfo } from "@/api/webhooks.js";
import type { AccountSummary } from "@clawbot/shared";
import { cn } from "../lib/cn.js";
import { formatCount, formatDateTime } from "../lib/format.js";

function WebhookTokenCard(props: {
  token: WebhookTokenInfo;
  accounts: AccountSummary[];
  busy: boolean;
  onOpenTest: () => void;
  onOpenLogs: () => void;
  onToggle: () => void;
  onRotate: () => void;
  onDelete: () => void;
}) {
  const accountLabels = props.token.accountIds.map((id) => {
    const acct = props.accounts.find((a) => a.id === id);
    return acct?.alias || acct?.display_name || id.slice(0, 12);
  });

  return (
    <div className="reveal-up group relative rounded-lg border border-[rgba(21,32,43,0.08)] bg-[rgba(255,255,255,0.88)] shadow-[0_22px_55px_-42px_rgba(15,23,42,0.38)] transition duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] hover:-translate-y-0.5 hover:border-[rgba(21,110,99,0.14)] hover:bg-[rgba(255,255,255,0.96)]">
      <div className="flex items-start gap-3 px-5 pt-5">
        <span
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-lg border transition",
            props.token.enabled
              ? "border-emerald-200 bg-emerald-50 text-emerald-600"
              : "border-[var(--line)] bg-[rgba(148,163,184,0.08)] text-[var(--muted)]",
          )}
        >
          <KeyIcon className="size-5" />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[14px] font-semibold tracking-[-0.03em] text-[var(--ink)]">
              {props.token.source}
            </span>
          </div>
          <p className="mt-0.5 truncate text-[12px] text-[var(--muted)]">
            {props.token.description || "未填写描述"}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2 self-start">
          <CardToggle
            enabled={props.token.enabled}
            busy={props.busy}
            label={props.token.enabled ? "停用 Webhook Token" : "启用 Webhook Token"}
            onToggle={props.onToggle}
          />
          <CardOverflowMenu
            items={[
              {
                label: "测试发送",
                tone: "success",
                onClick: props.onOpenTest,
                icon: <ActivityIcon className="size-4" />,
              },
              {
                label: "查看日志",
                tone: "primary",
                onClick: props.onOpenLogs,
                icon: <WebhookIcon className="size-4" />,
              },
              {
                label: "轮换 Token",
                tone: "warning",
                onClick: props.onRotate,
                icon: <RefreshIcon className="size-4" />,
              },
              {
                label: "删除 Token",
                tone: "danger",
                onClick: props.onDelete,
                icon: <TrashIcon className="size-4" />,
              },
            ]}
          />
        </div>
      </div>

      <div className="px-5">
        <MetricGrid
          items={[
            {
              icon: <KeyIcon className="size-3.5" />,
              label: "Token",
              value: <span className="font-mono text-[12px]">{props.token.tokenPrefix}...</span>,
            },
            {
              icon: <LayersIcon className="size-3.5" />,
              label: "授权账号",
              value: `${formatCount(props.token.accountIds.length)} 个`,
            },
            {
              icon: <ClockIcon className="size-3.5" />,
              label: "最近使用",
              value: props.token.lastUsedAt ? formatDateTime(props.token.lastUsedAt) : "从未使用",
            },
            {
              icon: <StackIcon className="size-3.5" />,
              label: "创建时间",
              value: formatDateTime(props.token.createdAt),
            },
          ]}
        />
      </div>

      <div className="mt-2.5 flex flex-wrap gap-1.5 px-5 pb-4">
        {accountLabels.map((label, i) => (
          <IconTag key={props.token.accountIds[i]} icon={<WebhookIcon className="size-3" />}>
            {label}
          </IconTag>
        ))}
      </div>
    </div>
  );
}

function WebhookTestModal(props: {
  token: WebhookTokenInfo;
  accounts: AccountSummary[];
  onClose: () => void;
}) {
  const [messageType, setMessageType] = useState<WebhookMessageType>("text");
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [conversationId, setConversationId] = useState("");
  const [text, setText] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    tone: "success" | "error";
    message: string;
    messageId?: string;
  } | null>(null);

  const authorizedAccounts = props.token.accountIds.map((id) => {
    const account = props.accounts.find((item) => item.id === id);
    return {
      id,
      label: account?.alias || account?.display_name || id,
      description: account?.display_name || account?.alias || id,
    };
  });

  useEffect(() => {
    if (!selectedAccountId && authorizedAccounts.length > 0) {
      setSelectedAccountId(authorizedAccounts[0].id);
    }
  }, [authorizedAccounts, selectedAccountId]);

  async function handleSubmit() {
    if (!selectedAccountId) {
      setError("请选择一个已授权账号");
      return;
    }

    if (!conversationId.trim()) {
      setError("请输入 conversationId");
      return;
    }

    if (messageType === "text" && !text.trim()) {
      setError("请输入文本消息内容");
      return;
    }

    if (messageType === "image" && !imageUrl.trim()) {
      setError("请输入图片 URL");
      return;
    }

    setBusy(true);
    setError(null);
    setResult(null);

    try {
      const response =
        messageType === "text"
          ? await testWebhookToken(props.token.source, {
              accountId: selectedAccountId,
              conversationId: conversationId.trim(),
              type: "text",
              text: text.trim(),
            })
          : await testWebhookToken(props.token.source, {
              accountId: selectedAccountId,
              conversationId: conversationId.trim(),
              type: "image",
              imageUrl: imageUrl.trim(),
              text: text.trim() || undefined,
            });

      setResult({
        tone: "success",
        message: `${response.type === "image" ? "图片" : "文本"}消息已发送，可到日志详情页继续查看记录。`,
        messageId: response.messageId,
      });
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      setError(message);
      setResult({
        tone: "error",
        message,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 md:p-6">
      <button
        type="button"
        aria-label="关闭 Webhook 调试弹窗"
        onClick={props.onClose}
        className="absolute inset-0 bg-[rgba(15,23,42,0.24)] backdrop-blur-[8px]"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="webhook-test-modal-title"
        className="relative z-10 flex max-h-[calc(100dvh-2rem)] w-full max-w-3xl flex-col overflow-hidden rounded-[30px] border border-[rgba(21,32,43,0.1)] bg-[rgba(255,255,255,0.96)] shadow-[0_40px_120px_-56px_rgba(15,23,42,0.52)]"
      >
        <div className="border-b border-[var(--line)] px-5 py-4 md:px-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[10px] uppercase tracking-[0.24em] text-[var(--muted)]">
                Webhook Test
              </p>
              <h3
                id="webhook-test-modal-title"
                className="mt-1.5 text-[22px] font-semibold tracking-[-0.04em] text-[var(--ink)]"
              >
                测试发送能力
              </h3>
            </div>

            <button
              type="button"
              onClick={props.onClose}
              className="inline-flex size-10 shrink-0 items-center justify-center rounded-full border border-[var(--line)] bg-white/80 text-[var(--muted-strong)] transition hover:border-[var(--line-strong)] hover:text-[var(--ink)]"
            >
              <XIcon className="size-4" />
            </button>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Badge tone={props.token.enabled ? "online" : "offline"}>
              {props.token.enabled ? "Token 已启用" : "Token 已停用"}
            </Badge>
            <Badge tone="muted">{props.token.source}</Badge>
            <Badge tone="muted">授权账号 {formatCount(props.token.accountIds.length)}</Badge>
          </div>
        </div>

        <form
          className="flex-1 space-y-5 overflow-y-auto px-5 py-5 md:px-6"
          onSubmit={(event) => {
            event.preventDefault();
            void handleSubmit();
          }}
        >
          <div className="space-y-3">
            <p className="text-[11px] uppercase tracking-[0.2em] text-[var(--muted)]">
              Message Type
            </p>
            <div className="flex flex-wrap gap-2">
              {(["text", "image"] as const).map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setMessageType(type)}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-[12px] transition",
                    messageType === type
                      ? "border-[var(--accent)] bg-[rgba(21,110,99,0.1)] text-[var(--accent-strong)]"
                      : "border-[var(--line)] text-[var(--muted-strong)] hover:bg-white",
                  )}
                >
                  {type === "text" ? "文本消息" : "图片消息"}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-4">
            <div className="rounded-xl border border-[var(--line)] bg-[rgba(247,250,251,0.84)] px-4 py-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-[10px] uppercase tracking-[0.22em] text-[var(--muted)]">
                    Authorized Accounts
                  </p>
                </div>
                <Badge tone="muted">{formatCount(authorizedAccounts.length)} items</Badge>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {authorizedAccounts.map((account) => (
                  <button
                    key={account.id}
                    type="button"
                    onClick={() => setSelectedAccountId(account.id)}
                    className={cn(
                      "rounded-full border px-3 py-1 text-[12px] transition",
                      selectedAccountId === account.id
                        ? "border-[var(--accent)] bg-[rgba(21,110,99,0.1)] text-[var(--accent-strong)]"
                        : "border-[var(--line)] text-[var(--muted-strong)] hover:bg-white",
                    )}
                  >
                    {account.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-[12px] text-[var(--muted-strong)]">Conversation ID *</label>
              <Input
                value={conversationId}
                onChange={(event) => setConversationId(event.target.value)}
                placeholder="例如 wxid_xxx 或现有会话 ID"
                className="mt-1"
              />
            </div>

            {messageType === "image" ? (
              <div>
                <label className="text-[12px] text-[var(--muted-strong)]">图片 URL *</label>
                <Input
                  value={imageUrl}
                  onChange={(event) => setImageUrl(event.target.value)}
                  placeholder="https://example.com/demo.png"
                  className="mt-1"
                />
              </div>
            ) : null}

            <div>
              <label className="text-[12px] text-[var(--muted-strong)]">
                {messageType === "image" ? "附言" : "消息内容 *"}
              </label>
              <textarea
                value={text}
                onChange={(event) => setText(event.target.value)}
                spellCheck={false}
                placeholder={
                  messageType === "image"
                    ? "可选：给图片附一段说明"
                    : "输入要通过 webhook 主动发送的文本"
                }
                className="mt-1 min-h-[120px] w-full rounded-[18px] border border-[var(--line-strong)] bg-[rgba(255,255,255,0.82)] px-4 py-3 text-[12px] leading-6 text-[var(--ink)] outline-none transition duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] placeholder:text-[var(--muted)] focus:border-[var(--accent)] focus:ring-[3px] focus:ring-[rgba(21,110,99,0.14)]"
              />
            </div>

            {error ? (
              <div className="rounded-[18px] border border-[rgba(185,28,28,0.12)] bg-[rgba(254,242,242,0.9)] px-4 py-3 text-[12px] leading-6 text-red-700">
                {error}
              </div>
            ) : null}

            {result ? (
              <div
                className={cn(
                  "rounded-[18px] border px-4 py-3 text-[12px] leading-6",
                  result.tone === "success"
                    ? "border-[rgba(21,110,99,0.14)] bg-[rgba(240,253,250,0.92)] text-[var(--accent-strong)]"
                    : "border-[rgba(185,28,28,0.12)] bg-[rgba(254,242,242,0.9)] text-red-700",
                )}
              >
                <p>{result.message}</p>
                {result.messageId ? (
                  <p className="mt-1 font-[var(--font-mono)] text-[11px] opacity-80">
                    messageId: {result.messageId}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="sticky bottom-0 flex flex-wrap justify-end gap-3 border-t border-[var(--line)] bg-[rgba(255,255,255,0.92)] px-1 pt-4">
            <Button type="button" variant="outline" onClick={props.onClose}>
              关闭
            </Button>
            <Button disabled={busy || !props.token.enabled} type="submit">
              {busy ? "发送中..." : "发送测试"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function CreateTokenModal(props: {
  accounts: AccountSummary[];
  onCreated: (token: string) => void;
  onClose: () => void;
}) {
  const [source, setSource] = useState("");
  const [description, setDescription] = useState("");
  const [selectedAccounts, setSelectedAccounts] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const toggle = (id: string) =>
    setSelectedAccounts((prev) =>
      prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id],
    );

  const handleSubmit = async () => {
    if (!source.trim()) {
      setError("请输入业务系统标识");
      return;
    }
    if (!selectedAccounts.length) {
      setError("请选择至少一个账号");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await createWebhookToken({
        source: source.trim(),
        description: description.trim() || undefined,
        accountIds: selectedAccounts,
      });
      props.onCreated(result.token);
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 md:p-6">
      <button
        type="button"
        aria-label="关闭 Webhook Token 创建弹窗"
        onClick={props.onClose}
        className="absolute inset-0 bg-[rgba(15,23,42,0.24)] backdrop-blur-[8px]"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="webhook-token-editor-title"
        className="relative z-10 flex max-h-[calc(100dvh-2rem)] w-full max-w-3xl flex-col overflow-hidden rounded-[30px] border border-[rgba(21,32,43,0.1)] bg-[rgba(255,255,255,0.96)] shadow-[0_40px_120px_-56px_rgba(15,23,42,0.52)]"
      >
        <div className="border-b border-[var(--line)] px-5 py-4 md:px-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[10px] uppercase tracking-[0.24em] text-[var(--muted)]">
                Create Token
              </p>
              <h3
                id="webhook-token-editor-title"
                className="mt-1.5 text-[22px] font-semibold tracking-[-0.04em] text-[var(--ink)]"
              >
                新建 Webhook Token
              </h3>
            </div>

            <button
              type="button"
              onClick={props.onClose}
              className="inline-flex size-10 shrink-0 items-center justify-center rounded-full border border-[var(--line)] bg-white/80 text-[var(--muted-strong)] transition hover:border-[var(--line-strong)] hover:text-[var(--ink)]"
            >
              <XIcon className="size-4" />
            </button>
          </div>
        </div>

        <form
          className="flex-1 space-y-5 overflow-y-auto px-5 py-5 md:px-6"
          onSubmit={(event) => {
            event.preventDefault();
            void handleSubmit();
          }}
        >
          <div className="grid gap-4">
            <div>
              <label className="text-[12px] text-[var(--muted-strong)]">业务系统标识 *</label>
              <Input
                value={source}
                onChange={(event) => setSource(event.target.value)}
                placeholder="例如 order-system"
                className="mt-1"
              />
            </div>

            <div>
              <label className="text-[12px] text-[var(--muted-strong)]">描述</label>
              <Input
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="例如 订单系统 Webhook"
                className="mt-1"
              />
            </div>

            <div className="rounded-xl border border-[var(--line)] bg-[rgba(247,250,251,0.84)] px-4 py-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-[10px] uppercase tracking-[0.22em] text-[var(--muted)]">
                    Authorized Accounts
                  </p>
                </div>
                <Badge tone="muted">{formatCount(selectedAccounts.length)} selected</Badge>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {props.accounts
                  .filter((account) => !account.deprecated)
                  .map((account) => (
                    <button
                      key={account.id}
                      type="button"
                      onClick={() => toggle(account.id)}
                      className={cn(
                        "rounded-full border px-3 py-1 text-[12px] transition",
                        selectedAccounts.includes(account.id)
                          ? "border-[var(--accent)] bg-[rgba(21,110,99,0.1)] text-[var(--accent-strong)]"
                          : "border-[var(--line)] text-[var(--muted-strong)] hover:bg-white",
                      )}
                    >
                      {account.alias || account.display_name || account.id}
                    </button>
                  ))}
              </div>
            </div>

            {error ? (
              <div className="rounded-[18px] border border-[rgba(185,28,28,0.12)] bg-[rgba(254,242,242,0.9)] px-4 py-3 text-[12px] leading-6 text-red-700">
                {error}
              </div>
            ) : null}
          </div>

          <div className="sticky bottom-0 flex flex-wrap justify-end gap-3 border-t border-[var(--line)] bg-[rgba(255,255,255,0.92)] px-1 pt-4">
            <Button type="button" variant="outline" onClick={props.onClose}>
              取消
            </Button>
            <Button disabled={busy} type="submit">
              {busy ? "创建中..." : "创建 Token"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function TokenCreatedNotice(props: { token: string; onDismiss: () => void }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(props.token);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="rounded-[18px] border border-emerald-200 bg-emerald-50/80 p-5">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-[14px] font-semibold text-emerald-800">Token 创建成功</h3>
          <p className="mt-1 text-[12px] text-emerald-600">请立即复制保存，此 Token 仅显示一次</p>
        </div>
        <button onClick={props.onDismiss} className="text-emerald-400 hover:text-emerald-600">
          <XIcon className="size-4" />
        </button>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <code className="flex-1 rounded-lg bg-white/80 px-3 py-2 text-[12px] font-mono text-emerald-800 break-all">
          {props.token}
        </code>
        <button
          onClick={handleCopy}
          className="shrink-0 rounded-lg border border-emerald-200 bg-white p-2 text-emerald-600 hover:bg-emerald-50"
        >
          {copied ? <CheckIcon className="size-4" /> : <CopyIcon className="size-4" />}
        </button>
      </div>
    </div>
  );
}

export function WebhooksPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const {
    data: tokensResp,
    isPending: loading,
    error: tokensError,
  } = useQuery({
    queryKey: queryKeys.webhookTokens,
    queryFn: fetchWebhookTokens,
  });
  const { accounts } = useAccounts();

  const [showCreate, setShowCreate] = useState(false);
  const [activeTestSource, setActiveTestSource] = useState<string | null>(null);
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [pendingToggle, setPendingToggle] = useState<string | null>(null);

  const tokens = tokensResp?.data ?? [];
  const error =
    tokensError instanceof Error ? tokensError.message : tokensError ? String(tokensError) : null;
  const activeTestToken = tokens.find((token) => token.source === activeTestSource) ?? null;
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.webhookTokens });
  };
  const enabledCount = tokens.filter((token) => token.enabled).length;
  const disabledCount = tokens.length - enabledCount;
  const activeAccountCount = new Set(tokens.flatMap((token) => token.accountIds)).size;

  useEffect(() => {
    if (!showCreate && !activeTestToken) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") {
        return;
      }

      if (activeTestToken) {
        setActiveTestSource(null);
        return;
      }

      setShowCreate(false);
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeTestToken, showCreate]);

  const handleToggle = async (source: string, enabled: boolean) => {
    setPendingToggle(source);
    try {
      await toggleWebhookToken(source, !enabled);
      refresh();
    } finally {
      setPendingToggle(null);
    }
  };

  const handleRotate = async (source: string) => {
    if (!confirm(`确定要轮换 ${source} 的 Token？旧 Token 将立即失效。`)) return;
    try {
      const result = await rotateWebhookToken(source);
      setCreatedToken(result.token);
      refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : "轮换失败");
    }
  };

  const handleDelete = async (source: string) => {
    if (!confirm(`确定要删除 ${source}？此操作不可恢复。`)) return;
    try {
      await deleteWebhookToken(source);
      refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : "删除失败");
    }
  };

  return (
    <div className="space-y-5">
      <section className="space-y-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-[10px] uppercase tracking-[0.24em] text-[var(--muted)]">Webhooks</p>
            <h2 className="mt-1.5 text-[24px] text-[var(--ink)]">Webhook Token 管理</h2>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={refresh}>
              <ActivityIcon className="size-4" />
              刷新列表
            </Button>
            {!showCreate ? (
              <Button size="sm" onClick={() => setShowCreate(true)}>
                <PlusIcon className="size-4" />
                创建 Token
              </Button>
            ) : null}
          </div>
        </div>

        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--muted)]">
            <Badge tone="muted">总数 {formatCount(tokens.length)}</Badge>
            <Badge tone="muted">启用 {formatCount(enabledCount)}</Badge>
            <Badge tone="muted">停用 {formatCount(disabledCount)}</Badge>
            <Badge tone="muted">关联账号 {formatCount(activeAccountCount)}</Badge>
          </div>
        </div>
      </section>

      {error ? (
        <div className="rounded-[18px] border border-[rgba(185,28,28,0.12)] bg-[rgba(254,242,242,0.9)] px-4 py-3 text-[12px] leading-6 text-red-700">
          加载 Webhook Token 失败：{error}
        </div>
      ) : null}

      {createdToken ? (
        <TokenCreatedNotice token={createdToken} onDismiss={() => setCreatedToken(null)} />
      ) : null}

      {loading ? (
        <section className="grid gap-4 xl:grid-cols-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <div
              key={index}
              className="overflow-hidden rounded-lg border border-[var(--line)] bg-[rgba(255,255,255,0.8)] px-4 py-4 md:px-5"
            >
              <div className="flex items-center gap-3">
                <div className="ui-skeleton size-10 rounded-lg" />
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="ui-skeleton h-5 rounded-[8px]" />
                  <div className="ui-skeleton h-4 rounded-[8px]" />
                  <div className="ui-skeleton h-3 w-2/3 rounded-full" />
                </div>
                <div className="ui-skeleton h-8 w-[50px] rounded-full" />
              </div>
              <div className="mt-4 space-y-2">
                <div className="ui-skeleton h-3 rounded-full" />
                <div className="ui-skeleton h-3 w-4/5 rounded-full" />
                <div className="ui-skeleton h-8 w-2/3 rounded-[12px]" />
              </div>
            </div>
          ))}
        </section>
      ) : null}

      {!loading && tokens.length === 0 && !showCreate ? (
        <section className="rounded-[28px] border border-dashed border-[var(--line)] bg-[rgba(255,255,255,0.48)] px-5 py-10 text-center">
          <WebhookIcon className="mx-auto size-8 text-[var(--muted)]" />
          <p className="mt-3 text-[15px] font-medium text-[var(--ink)]">暂无 Webhook Token</p>
        </section>
      ) : null}

      {!loading && tokens.length > 0 ? (
        <section className="space-y-3">
          <div className="flex items-center gap-2 text-[11px] text-[var(--muted)]">
            <WebhookIcon className="size-4 text-[var(--muted-strong)]" />
            <span>当前展示 {formatCount(tokens.length)} 个 Webhook Token</span>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            {tokens.map((token) => (
              <WebhookTokenCard
                key={token.source}
                token={token}
                accounts={accounts ?? []}
                busy={pendingToggle === token.source}
                onOpenTest={() => setActiveTestSource(token.source)}
                onOpenLogs={() => navigate(`/webhooks/${encodeURIComponent(token.source)}/logs`)}
                onToggle={() => handleToggle(token.source, token.enabled)}
                onRotate={() => handleRotate(token.source)}
                onDelete={() => handleDelete(token.source)}
              />
            ))}
          </div>
        </section>
      ) : null}

      {showCreate ? (
        <CreateTokenModal
          accounts={accounts ?? []}
          onCreated={(token) => {
            setCreatedToken(token);
            setShowCreate(false);
            refresh();
          }}
          onClose={() => setShowCreate(false)}
        />
      ) : null}

      {activeTestToken ? (
        <WebhookTestModal
          token={activeTestToken}
          accounts={accounts ?? []}
          onClose={() => setActiveTestSource(null)}
        />
      ) : null}
    </div>
  );
}
