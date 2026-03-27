export function QrCodeDisplay({ qrText }: { qrText: string }) {
  return (
    <div className="flex h-full items-center justify-center bg-[linear-gradient(180deg,rgba(255,255,255,0.9),rgba(247,250,251,0.94))] px-6 py-8 md:px-8">
      <div className="flex flex-col items-center gap-4">
        <p className="text-[10px] uppercase tracking-[0.22em] text-[var(--muted)]">
          使用微信扫一扫完成绑定
        </p>
        <div className="inline-flex min-w-fit items-center justify-center border border-[var(--line)] bg-white p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]">
          <pre
            className="inline-block bg-white text-[8px] leading-[9px] tracking-[0] text-[#111827]"
            style={{ fontFamily: '"JetBrains Mono", "Courier New", Monaco, monospace' }}
          >
            {qrText}
          </pre>
        </div>
      </div>
    </div>
  );
}
