import { useEffect, useState } from "react";
import { Badge, Button, Input } from "@clawbot/ui";
import { XIcon } from "@clawbot/ui";
import type { WebhookMessageType, WebhookTokenInfo } from "@/api/webhooks.js";
import { testWebhookToken } from "@/api/webhooks.js";
import type { AccountSummary } from "@clawbot/shared";
import { cn } from "@/lib/cn.js";
import { formatCount } from "@/lib/format.js";

export interface WebhookTestModalProps {
  token: WebhookTokenInfo;
  accounts: AccountSummary[];
  onClose: () => void;
}

export function WebhookTestModal(props: WebhookTestModalProps) {
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
        className="absolute inset-0 bg-overlay backdrop-blur-[8px]"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="webhook-test-modal-title"
        className="relative z-10 flex max-h-[calc(100dvh-2rem)] w-full max-w-3xl flex-col overflow-hidden rounded-pill border border-modal-border bg-card-hover shadow-modal"
      >
        <div className="border-b border-line px-5 py-4 md:px-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-label-xl text-muted">Webhook Test</p>
              <h3
                id="webhook-test-modal-title"
                className="mt-1.5 text-5xl font-semibold tracking-heading text-ink"
              >
                测试发送能力
              </h3>
            </div>

            <button
              type="button"
              onClick={props.onClose}
              className="inline-flex size-10 shrink-0 items-center justify-center rounded-full border border-line bg-white/80 text-muted-strong transition hover:border-line-strong hover:text-ink"
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
            <p className="text-sm uppercase tracking-label text-muted">Message Type</p>
            <div className="flex flex-wrap gap-2">
              {(["text", "image"] as const).map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setMessageType(type)}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-base transition",
                    messageType === type
                      ? "border-accent bg-accent-soft text-accent-strong"
                      : "border-line text-muted-strong hover:bg-white",
                  )}
                >
                  {type === "text" ? "文本消息" : "图片消息"}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-4">
            <div className="rounded-xl border border-line bg-detail-bg px-4 py-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-label-lg text-muted">
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
                      "rounded-full border px-3 py-1 text-base transition",
                      selectedAccountId === account.id
                        ? "border-accent bg-accent-soft text-accent-strong"
                        : "border-line text-muted-strong hover:bg-white",
                    )}
                  >
                    {account.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-base text-muted-strong">Conversation ID *</label>
              <Input
                value={conversationId}
                onChange={(event) => setConversationId(event.target.value)}
                placeholder="例如 wxid_xxx 或现有会话 ID"
                className="mt-1"
              />
            </div>

            {messageType === "image" ? (
              <div>
                <label className="text-base text-muted-strong">图片 URL *</label>
                <Input
                  value={imageUrl}
                  onChange={(event) => setImageUrl(event.target.value)}
                  placeholder="https://example.com/demo.png"
                  className="mt-1"
                />
              </div>
            ) : null}

            <div>
              <label className="text-base text-muted-strong">
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
                className="mt-1 min-h-[120px] w-full rounded-section border border-line-strong bg-glass-82 px-4 py-3 text-base leading-6 text-ink outline-none transition duration-300 ease-expo placeholder:text-muted focus:border-accent focus:shadow-focus-accent"
              />
            </div>

            {error ? (
              <div className="rounded-section border border-notice-error-border bg-notice-error-bg px-4 py-3 text-base leading-6 text-red-700">
                {error}
              </div>
            ) : null}

            {result ? (
              <div
                className={cn(
                  "rounded-section border px-4 py-3 text-base leading-6",
                  result.tone === "success"
                    ? "border-notice-success-border bg-notice-success-bg text-accent-strong"
                    : "border-notice-error-border bg-notice-error-bg text-red-700",
                )}
              >
                <p>{result.message}</p>
                {result.messageId ? (
                  <p className="mt-1 font-mono text-sm opacity-80">messageId: {result.messageId}</p>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="sticky bottom-0 flex flex-wrap justify-end gap-3 border-t border-line bg-glass-92 px-1 pt-4">
            <Button size="sm" type="button" variant="secondary" onClick={props.onClose}>
              关闭
            </Button>
            <Button size="sm" disabled={busy || !props.token.enabled} type="submit">
              {busy ? "发送中..." : "发送测试"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
