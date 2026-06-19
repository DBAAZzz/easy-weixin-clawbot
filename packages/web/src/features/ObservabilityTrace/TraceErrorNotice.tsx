export function TraceErrorNotice({ error }: { error: string | null }) {
  if (!error) return null;

  return (
    <div className="rounded-section border border-notice-error-border bg-notice-error-bg px-4 py-3 text-base leading-5 text-danger">
      加载链路详情失败：{error}
    </div>
  );
}
