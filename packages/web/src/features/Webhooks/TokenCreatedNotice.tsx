import { useState } from "react";
import { XIcon, CopyIcon, CheckIcon } from "@clawbot/ui";

export interface TokenCreatedNoticeProps {
  token: string;
  onDismiss: () => void;
}

export function TokenCreatedNotice(props: TokenCreatedNoticeProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(props.token);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="rounded-section border border-emerald-200 bg-emerald-50/80 p-5">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-lg font-semibold text-emerald-800">Token 创建成功</h3>
          <p className="mt-1 text-base text-emerald-600">请立即复制保存，此 Token 仅显示一次</p>
        </div>
        <button onClick={props.onDismiss} className="text-emerald-400 hover:text-emerald-600">
          <XIcon className="size-4" />
        </button>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <code className="flex-1 rounded-lg bg-white/80 px-3 py-2 text-base font-mono text-emerald-800 break-all">
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
