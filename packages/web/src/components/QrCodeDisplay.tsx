import { useEffect, useState } from "react";
import QRCode from "qrcode";

export function QrCodeDisplay({ qrText }: { qrText: string }) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);

  useEffect(() => {
    const nextQrText = qrText.trim();

    if (!nextQrText) {
      setImageUrl(null);
      setRenderError(null);
      return;
    }

    let cancelled = false;

    setImageUrl(null);
    setRenderError(null);

    void QRCode.toDataURL(nextQrText, {
      color: {
        dark: "#15202b",
        light: "#ffffff",
      },
      errorCorrectionLevel: "M",
      margin: 1,
      width: 320,
    })
      .then((nextImageUrl: string) => {
        if (!cancelled) {
          setImageUrl(nextImageUrl);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setRenderError(error instanceof Error ? error.message : String(error));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [qrText]);

  return (
    <div className="bg-qr-shell flex h-full items-center justify-center px-6 py-8 md:px-8">
      <div className="flex flex-col items-center gap-4">
        <p className="text-xs uppercase tracking-label-lg text-muted">使用微信扫一扫完成绑定</p>
        <div className="shadow-inset-white inline-flex min-w-fit items-center justify-center border border-line bg-white p-3">
          {imageUrl ? (
            <img
              src={imageUrl}
              alt="微信绑定二维码"
              className="size-72 object-contain md:size-80"
            />
          ) : renderError ? (
            <div className="flex flex-col items-center gap-3 text-center">
              <p className="text-sm text-muted-strong">二维码生成失败，请重试</p>
              <pre className="qr-ascii font-mono">{qrText}</pre>
            </div>
          ) : qrText.trim() ? (
            <div className="bg-frost-72 flex size-72 items-center justify-center text-sm text-muted md:size-80">
              生成二维码中...
            </div>
          ) : (
            <pre className="qr-ascii font-mono">{qrText}</pre>
          )}
        </div>
      </div>
    </div>
  );
}
