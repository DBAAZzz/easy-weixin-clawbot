import { useState } from "react";
import { Badge, Button, Input } from "@clawbot/ui";
import { XIcon } from "@clawbot/ui";
import { createWebhookToken } from "@/api/webhooks.js";
import type { AccountSummary } from "@clawbot/shared";
import { cn } from "@/lib/cn.js";
import { formatCount } from "@/lib/format.js";

export interface CreateTokenModalProps {
  accounts: AccountSummary[];
  onCreated: (token: string) => void;
  onClose: () => void;
}

export function CreateTokenModal(props: CreateTokenModalProps) {
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
        className="absolute inset-0 bg-overlay backdrop-blur-[8px]"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="webhook-token-editor-title"
        className="relative z-10 flex max-h-[calc(100dvh-2rem)] w-full max-w-3xl flex-col overflow-hidden rounded-pill border border-modal-border bg-card-hover shadow-modal"
      >
        <div className="border-b border-line px-5 py-4 md:px-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-label-xl text-muted">Create Token</p>
              <h3
                id="webhook-token-editor-title"
                className="mt-1.5 text-5xl font-semibold tracking-heading text-ink"
              >
                新建 Webhook Token
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
              <label className="text-base text-muted-strong">业务系统标识 *</label>
              <Input
                value={source}
                onChange={(event) => setSource(event.target.value)}
                placeholder="例如 order-system"
                className="mt-1"
              />
            </div>

            <div>
              <label className="text-base text-muted-strong">描述</label>
              <Input
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="例如 订单系统 Webhook"
                className="mt-1"
              />
            </div>

            <div className="rounded-xl border border-line bg-detail-bg px-4 py-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-label-lg text-muted">
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
                        "rounded-full border px-3 py-1 text-base transition",
                        selectedAccounts.includes(account.id)
                          ? "border-accent bg-accent-soft text-accent-strong"
                          : "border-line text-muted-strong hover:bg-white",
                      )}
                    >
                      {account.alias || account.display_name || account.id}
                    </button>
                  ))}
              </div>
            </div>

            {error ? (
              <div className="rounded-section border border-notice-error-border bg-notice-error-bg px-4 py-3 text-base leading-6 text-red-700">
                {error}
              </div>
            ) : null}
          </div>

          <div className="sticky bottom-0 flex flex-wrap justify-end gap-3 border-t border-line bg-glass-92 px-1 pt-4">
            <Button size="sm" type="button" variant="secondary" onClick={props.onClose}>
              取消
            </Button>
            <Button size="sm" disabled={busy} type="submit">
              {busy ? "创建中..." : "创建 Token"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
