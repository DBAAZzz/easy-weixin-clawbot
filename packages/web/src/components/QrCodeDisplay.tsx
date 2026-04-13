export function QrCodeDisplay({ qrText }: { qrText: string }) {
  return (
    <div className="bg-qr-shell flex h-full items-center justify-center px-6 py-8 md:px-8">
      <div className="flex flex-col items-center gap-4">
        <p className="text-xs uppercase tracking-label-lg text-muted">使用微信扫一扫完成绑定</p>
        <div className="shadow-inset-white inline-flex min-w-fit items-center justify-center border border-line bg-white p-3">
          <pre
            className="qr-ascii"
            style={{ fontFamily: '"JetBrains Mono", "Courier New", Monaco, monospace' }}
          >
            {qrText}
          </pre>
        </div>
      </div>
    </div>
  );
}
