import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { fetchRssTasks } from "@/api/rss.js";
import { Badge } from "../components/ui/badge.js";
import { ConversationList } from "../components/ConversationList.js";
import { MessageList } from "../components/MessageList.js";
import { Button } from "../components/ui/button.js";
import { ActivityIcon, LinkIcon, StackIcon } from "../components/ui/icons.js";
import { formatCount, formatDateTime, formatRelativeTime } from "../lib/format.js";
import { queryKeys } from "../lib/query-keys.js";
import { useConversations } from "../hooks/useConversations.js";
import { useMessages } from "../hooks/useMessages.js";

export function ConversationPage() {
  const navigate = useNavigate();
  const { accountId } = useParams<{ accountId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedConversationId = searchParams.get("conversation") ?? undefined;
  const { conversations, loading, error, refresh } = useConversations(accountId);
  const messages = useMessages(accountId, selectedConversationId);
  const {
    data: rssTasks = [],
    isPending: rssTasksLoading,
    error: rssTasksError,
  } = useQuery({
    queryKey: queryKeys.rssTasks(accountId),
    queryFn: () => fetchRssTasks(accountId),
    enabled: Boolean(accountId),
    staleTime: 15_000,
  });

  useEffect(() => {
    if (!conversations.length) return;

    const found = conversations.some(
      (conversation) => conversation.conversation_id === selectedConversationId,
    );

    if (selectedConversationId && found) return;

    setSearchParams({ conversation: conversations[0].conversation_id }, { replace: true });
  }, [conversations, selectedConversationId, setSearchParams]);

  const selectedConversation = conversations.find(
    (conversation) => conversation.conversation_id === selectedConversationId,
  );
  const conversationTitle = selectedConversation?.title ?? selectedConversationId ?? "未选择会话";
  const conversationMeta = selectedConversation
    ? `${formatCount(selectedConversation.message_count)} 条消息 · ${formatRelativeTime(selectedConversation.last_message_at)}`
    : null;
  const conversationBadge = conversationTitle.trim().slice(0, 1).toUpperCase() || "C";

  return (
    <div className="grid h-full min-h-[640px] overflow-hidden rounded-lg border border-line-strong lg:grid-cols-[300px_minmax(0,1fr)] xl:grid-cols-[320px_minmax(0,1fr)]">
      <aside className="bg-pane-78 flex min-h-0 flex-col border-r border-line backdrop-blur-sm">
        {" "}
        <div className="border-b border-line px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-label-lg text-muted">账号</p>
              <h2 className="mt-1.5 break-all text-2xl font-medium text-ink">
                {conversations[0]?.account_alias ||
                  conversations[0]?.account_display_name ||
                  accountId ||
                  "未知账号"}
              </h2>
              <p className="mt-1 text-sm text-muted">{formatCount(conversations.length)} 条会话</p>
            </div>

            <Button variant="outline" size="sm" onClick={refresh}>
              <ActivityIcon className="size-4" />
              刷新
            </Button>
          </div>

          {error ? (
            <div className="mt-3 border border-notice-error-border bg-notice-error-bg px-3 py-2 text-sm leading-5 text-red-700">
              加载会话列表失败：{error}
            </div>
          ) : null}

          <div className="mt-3 rounded-panel border border-line bg-panel px-3 py-3 shadow-card">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-label-lg text-muted">RSS 任务</p>
                <p className="mt-1 text-sm leading-6 text-muted-strong">
                  当前账号关联的 RSS 快讯与摘要任务。
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  navigate(accountId ? `/task-center?accountId=${accountId}` : "/task-center")
                }
              >
                <StackIcon className="size-4" />
                打开任务中心
              </Button>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              <Badge tone="muted">总数 {formatCount(rssTasks.length)}</Badge>
              <Badge tone="online">
                启用 {formatCount(rssTasks.filter((task) => task.enabled).length)}
              </Badge>
            </div>

            {rssTasksError ? (
              <div className="mt-3 rounded-panel border border-notice-error-border bg-notice-error-bg px-3 py-2 text-sm leading-5 text-red-700">
                加载 RSS 任务失败：
                {rssTasksError instanceof Error ? rssTasksError.message : String(rssTasksError)}
              </div>
            ) : null}

            {rssTasksLoading ? (
              <div className="mt-3 space-y-2">
                {Array.from({ length: 2 }).map((_, index) => (
                  <div key={index} className="ui-skeleton h-14 rounded-lg" />
                ))}
              </div>
            ) : rssTasks.length === 0 ? (
              <div className="mt-3 rounded-panel border border-dashed border-line bg-glass-48 px-4 py-4 text-sm leading-6 text-muted-strong">
                暂无 RSS 任务。可以去任务中心新建一个与当前账号绑定的订阅任务。
              </div>
            ) : (
              <div className="mt-3 space-y-2">
                {rssTasks.slice(0, 3).map((task) => (
                  <button
                    key={task.id}
                    type="button"
                    onClick={() => navigate(`/task-center?accountId=${task.account_id}`)}
                    className="w-full rounded-panel border border-line bg-white/70 px-3 py-3 text-left transition hover:border-notice-success-border hover:bg-card-hover"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-ink">{task.name}</p>
                        <p className="mt-1 text-xs text-muted-strong">
                          {task.task_kind === "rss_digest" ? "摘要任务" : "快讯任务"} · {task.cron}
                        </p>
                      </div>
                      <Badge
                        tone={
                          task.status === "error" ? "error" : task.enabled ? "online" : "offline"
                        }
                      >
                        {task.status}
                      </Badge>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Badge tone="muted">订阅源 {formatCount(task.source_count)}</Badge>
                      <Badge tone="muted">上次执行 {formatDateTime(task.last_run_at)}</Badge>
                    </div>
                  </button>
                ))}
                {rssTasks.length > 3 ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="w-full justify-center"
                    onClick={() =>
                      navigate(accountId ? `/task-center?accountId=${accountId}` : "/task-center")
                    }
                  >
                    <LinkIcon className="size-4" />
                    查看全部 {formatCount(rssTasks.length)} 个任务
                  </Button>
                ) : null}
              </div>
            )}
          </div>
        </div>
        {loading && conversations.length === 0 ? (
          <div className="space-y-0 p-4">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="ui-skeleton h-16 border-b border-line last:border-b-0" />
            ))}
          </div>
        ) : (
          <ConversationList
            conversations={conversations}
            selectedConversationId={selectedConversationId}
            onSelect={(conversationId) => setSearchParams({ conversation: conversationId })}
          />
        )}
      </aside>

      <section className="flex min-h-0 flex-col bg-glass-74 backdrop-blur-sm">
        <div className="flex items-center justify-between gap-4 border-b border-line px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-base font-semibold text-accent-strong">
              {conversationBadge}
            </span>
            <div className="min-w-0">
              <p className="truncate text-lg font-medium text-ink">{conversationTitle}</p>
              {conversationMeta ? (
                <p className="mt-0.5 text-sm text-muted">{conversationMeta}</p>
              ) : null}
            </div>
          </div>

          <Button size="sm" variant="outline" onClick={messages.refresh}>
            <ActivityIcon className="size-4" />
            刷新消息
          </Button>
        </div>

        {messages.error ? (
          <div className="border-b border-notice-error-border bg-notice-error-bg px-4 py-2.5 text-sm leading-5 text-red-700">
            加载消息失败：{messages.error}
          </div>
        ) : null}

        <MessageList
          messages={messages.messages}
          loading={messages.loading}
          loadingMore={messages.loadingMore}
          hasMore={messages.hasMore}
          onLoadMore={messages.loadMore}
        />
      </section>
    </div>
  );
}
