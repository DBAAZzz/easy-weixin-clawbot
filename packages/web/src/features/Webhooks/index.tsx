import { Badge, Button } from "@clawbot/ui";
import { WebhookIcon, ActivityIcon, PlusIcon } from "@clawbot/ui";
import { formatCount } from "@/lib/format.js";
import { useWebhooks } from "./useWebhooks.js";
import { WebhookTokenCard } from "./WebhookTokenCard.js";
import { WebhookTestModal } from "./WebhookTestModal.js";
import { CreateTokenModal } from "./CreateTokenModal.js";
import { TokenCreatedNotice } from "./TokenCreatedNotice.js";

export function WebhooksPage() {
  const {
    tokens,
    error,
    loading,
    accounts,
    showCreate,
    setShowCreate,
    setActiveTestSource,
    createdToken,
    setCreatedToken,
    activeTestToken,
    pendingToggle,
    enabledCount,
    disabledCount,
    activeAccountCount,
    refresh,
    handleToggle,
    handleRotate,
    handleDelete,
    handleOpenLogs,
  } = useWebhooks();

  return (
    <div className="space-y-5">
      <section className="space-y-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs uppercase tracking-label-xl text-muted">Webhooks</p>
            <h2 className="mt-1.5 text-6xl text-ink">Webhook Token 管理</h2>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="secondary" onClick={refresh}>
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
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
            <Badge tone="muted">总数 {formatCount(tokens.length)}</Badge>
            <Badge tone="muted">启用 {formatCount(enabledCount)}</Badge>
            <Badge tone="muted">停用 {formatCount(disabledCount)}</Badge>
            <Badge tone="muted">关联账号 {formatCount(activeAccountCount)}</Badge>
          </div>
        </div>
      </section>

      {error ? (
        <div className="rounded-section border border-notice-error-border bg-notice-error-bg px-4 py-3 text-base leading-6 text-red-700">
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
              className="overflow-hidden rounded-lg border border-line bg-glass-80 px-4 py-4 md:px-5"
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
              <div className="mt-4 space-y-2">
                <div className="ui-skeleton h-3 rounded-full" />
                <div className="ui-skeleton h-3 w-4/5 rounded-full" />
                <div className="ui-skeleton h-8 w-2/3 rounded-panel" />
              </div>
            </div>
          ))}
        </section>
      ) : null}

      {!loading && tokens.length === 0 && !showCreate ? (
        <section className="rounded-dialog border border-dashed border-line bg-glass-48 px-5 py-10 text-center">
          <WebhookIcon className="mx-auto size-8 text-muted" />
          <p className="mt-3 text-xl font-medium text-ink">暂无 Webhook Token</p>
        </section>
      ) : null}

      {!loading && tokens.length > 0 ? (
        <section className="space-y-3">
          <div className="flex items-center gap-2 text-sm text-muted">
            <WebhookIcon className="size-4 text-muted-strong" />
            <span>当前展示 {formatCount(tokens.length)} 个 Webhook Token</span>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            {tokens.map((token) => (
              <WebhookTokenCard
                key={token.source}
                token={token}
                accounts={accounts}
                busy={pendingToggle === token.source}
                onOpenTest={() => setActiveTestSource(token.source)}
                onOpenLogs={() => handleOpenLogs(token.source)}
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
          accounts={accounts}
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
          accounts={accounts}
          onClose={() => setActiveTestSource(null)}
        />
      ) : null}
    </div>
  );
}
