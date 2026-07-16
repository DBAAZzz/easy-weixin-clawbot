import { ErrorNotice } from "@/components/ErrorNotice.js";

export function TraceErrorNotice({ error }: { error: string | null }) {
  if (!error) return null;

  return <ErrorNotice>加载链路详情失败：{error}</ErrorNotice>;
}
