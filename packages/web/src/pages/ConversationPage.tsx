import { useEffect } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { ConversationList } from '../components/ConversationList.js'
import { MessageList } from '../components/MessageList.js'
import { Button } from '../components/ui/button.js'
import { ActivityIcon } from '../components/ui/icons.js'
import { formatCount, formatRelativeTime } from '../lib/format.js'
import { useConversations } from '../hooks/useConversations.js'
import { useMessages } from '../hooks/useMessages.js'

export function ConversationPage() {
  const { accountId } = useParams<{ accountId: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const selectedConversationId = searchParams.get('conversation') ?? undefined
  const { conversations, loading, error, refresh } = useConversations(accountId)
  const messages = useMessages(accountId, selectedConversationId)

  useEffect(() => {
    if (!conversations.length) return

    const found = conversations.some(
      (conversation) => conversation.conversation_id === selectedConversationId,
    )

    if (selectedConversationId && found) return

    setSearchParams(
      { conversation: conversations[0].conversation_id },
      { replace: true },
    )
  }, [conversations, selectedConversationId, setSearchParams])

  const selectedConversation = conversations.find(
    (conversation) => conversation.conversation_id === selectedConversationId,
  )
  const conversationTitle =
    selectedConversation?.title ??
    selectedConversationId ??
    '选择一条会话查看详情'
  const conversationMeta = selectedConversation
    ? `${formatCount(selectedConversation.message_count)} 条消息 · ${formatRelativeTime(selectedConversation.last_message_at)}`
    : '左侧选择会话后，在这里查看消息记录'
  const conversationBadge =
    conversationTitle.trim().slice(0, 1).toUpperCase() || 'C'

  return (
    <div className='h-full overflow-hidden border border-[var(--line-strong)] bg-[rgba(255,255,255,0.74)]'>
      <div className='grid h-full min-h-[640px] lg:grid-cols-[300px_minmax(0,1fr)] xl:grid-cols-[320px_minmax(0,1fr)]'>
        <aside className='flex min-h-0 flex-col border-r border-[var(--line)] bg-[rgba(246,249,250,0.78)]'>
          <div className='border-b border-[var(--line)] px-4 py-3'>
            <div className='flex items-start justify-between gap-3'>
              <div className='min-w-0'>
                <p className='text-[10px] uppercase tracking-[0.22em] text-[var(--muted)]'>
                  账号
                </p>
                <h2 className='mt-1.5 break-all text-[16px] font-medium text-[var(--ink)]'>
                  {accountId ?? '未知账号'}
                </h2>
                <p className='mt-1 text-[11px] text-[var(--muted)]'>
                  {formatCount(conversations.length)} 条会话
                </p>
              </div>

              <Button variant='outline' size='sm' onClick={refresh}>
                <ActivityIcon className='size-4' />
                刷新
              </Button>
            </div>

            {error ? (
              <div className='mt-3 border border-[rgba(185,28,28,0.12)] bg-[rgba(254,242,242,0.9)] px-3 py-2 text-[11px] leading-5 text-red-700'>
                加载会话列表失败：{error}
              </div>
            ) : null}
          </div>

          {loading && conversations.length === 0 ? (
            <div className='space-y-2 p-4'>
              {Array.from({ length: 6 }).map((_, index) => (
                <div
                  key={index}
                  className='ui-skeleton h-[64px] rounded-[10px]'
                />
              ))}
            </div>
          ) : (
            <ConversationList
              conversations={conversations}
              selectedConversationId={selectedConversationId}
              onSelect={(conversationId) =>
                setSearchParams({ conversation: conversationId })
              }
            />
          )}
        </aside>

        <section className='flex min-h-0 flex-col'>
          <div className='flex items-center justify-between gap-4 border-b border-[var(--line)] px-4 py-3'>
            <div className='flex min-w-0 items-center gap-3'>
              <span className='flex size-9 shrink-0 items-center justify-center rounded-full bg-[rgba(21,110,99,0.1)] text-[12px] font-semibold text-[var(--accent-strong)]'>
                {conversationBadge}
              </span>
              <div className='min-w-0'>
                <p className='truncate text-[14px] font-medium text-[var(--ink)]'>
                  {conversationTitle}
                </p>
                <p className='mt-0.5 text-[11px] text-[var(--muted)]'>
                  {conversationMeta}
                </p>
              </div>
            </div>

            <Button size='sm' variant='outline' onClick={messages.refresh}>
              <ActivityIcon className='size-4' />
              刷新消息
            </Button>
          </div>

          {messages.error ? (
            <div className='border-b border-[rgba(185,28,28,0.12)] bg-[rgba(254,242,242,0.9)] px-4 py-2.5 text-[11px] leading-5 text-red-700'>
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
    </div>
  )
}
