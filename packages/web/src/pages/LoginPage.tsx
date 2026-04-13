import { useEffect, useState } from "react";
import type { LoginState } from "@clawbot/shared";
import { useNavigate } from "react-router-dom";
import { QrCodeDisplay } from "../components/QrCodeDisplay.js";
import { Button } from "../components/ui/button.js";
import { ActivityIcon, ScanIcon } from "../components/ui/icons.js";
import { cancelLogin, fetchLoginStatus, startLogin } from "@/api/wechat-login.js";

function statusMeta(state: LoginState) {
  switch (state.status) {
    case "idle":
      return {
        label: "等待启动",
        description: "页面已加载，正在向服务端请求新的二维码。",
        tone: "muted" as const,
      };
    case "qr_ready":
      return {
        label: "二维码已生成",
        description: "使用微信扫一扫，随后在手机上确认登录。",
        tone: "online" as const,
      };
    case "scanning":
      return {
        label: "等待手机确认",
        description: state.message ?? "二维码已被扫描，等待手机端完成授权。",
        tone: "online" as const,
      };
    case "done":
      return {
        label: "连接完成",
        description: `账号 ${state.account_id} 已接入，页面即将返回工作台。`,
        tone: "online" as const,
      };
    case "expired":
      return {
        label: "二维码已失效",
        description: "请重新开始，以获取新的二维码。",
        tone: "offline" as const,
      };
    case "error":
      return {
        label: "连接失败",
        description: state.message,
        tone: "offline" as const,
      };
  }
}

export function LoginPage() {
  const navigate = useNavigate();
  const [state, setState] = useState<LoginState>({ status: "idle" });
  const [error, setError] = useState<string | null>(null);
  const meta = statusMeta(state);
  const qrVisible = state.status === "qr_ready" || state.status === "scanning";
  const statusToneClassName =
    meta.tone === "online"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : meta.tone === "offline"
        ? "border-slate-200 bg-slate-100 text-slate-600"
        : "border-line bg-white/72 text-muted-strong";

  // 进入页面时只查状态，不自动触发登录
  useEffect(() => {
    let cancelled = false;

    void fetchLoginStatus()
      .then((nextState) => {
        if (cancelled) return;
        // 如果上次登录流程还在进行中，继续显示
        if (nextState.status !== "idle") {
          setState(nextState);
        }
      })
      .catch(() => {
        // 忽略初始状态查询失败
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (state.status === "done") {
      navigate("/", { replace: true });
      return;
    }

    // 只在登录流程进行中才轮询
    if (state.status === "idle" || state.status === "expired" || state.status === "error") {
      return;
    }

    const timer = window.setInterval(() => {
      void fetchLoginStatus()
        .then((nextState) => {
          setState(nextState);
        })
        .catch((reason) => {
          setError(reason instanceof Error ? reason.message : String(reason));
        });
    }, 2_000);

    return () => {
      window.clearInterval(timer);
    };
  }, [navigate, state.status]);

  async function handleRestart() {
    setError(null);
    setState(await startLogin());
  }

  async function handleCancel() {
    setError(null);
    setState(await cancelLogin());
  }

  const emptyTitle =
    state.status === "error"
      ? "生成失败"
      : state.status === "expired"
        ? "二维码已失效"
        : "等待生成二维码";
  const emptyMessage = state.status === "error" ? (error ?? state.message) : null;
  const emptyToneClassName =
    state.status === "error" || state.status === "expired"
      ? "border-notice-error-border bg-notice-error-bg text-red-700"
      : "border-dashed border-line bg-frost-72 text-muted";

  return (
    <div className="flex min-h-full flex-col gap-2.5 md:gap-3">
      <section className="space-y-2.5">
        <div className="flex flex-col gap-2.5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs uppercase tracking-label-xl text-muted">Bind Clawbot</p>
            <h2 className="mt-1.5 text-4xl text-ink">扫码绑定 Clawbot</h2>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center border px-2.5 py-1 text-xs font-medium tracking-badge ${statusToneClassName}`}
            >
              {meta.label}
            </span>
            <Button size="sm" className="rounded-none" onClick={handleRestart}>
              <ScanIcon className="size-4" />
              {state.status === "idle" ? "生成二维码" : "重新生成"}
            </Button>
            {state.status !== "idle" && state.status !== "done" ? (
              <Button size="sm" variant="outline" className="rounded-none" onClick={handleCancel}>
                <ActivityIcon className="size-4" />
                取消
              </Button>
            ) : null}
          </div>
        </div>
      </section>

      <section className="flex flex-1 items-center justify-center">
        <div className="aspect-square w-full max-w-[540px] overflow-hidden rounded-lg border border-line-strong bg-panel">
          {" "}
          {qrVisible ? (
            <QrCodeDisplay qrText={state.qr_text ?? ""} />
          ) : (
            <div className="bg-qr-shell-soft flex h-full items-center justify-center px-6 py-8">
              <div
                className={`w-full max-w-[320px] border px-5 py-6 text-center ${emptyToneClassName}`}
              >
                <p className="text-xl font-medium">{emptyTitle}</p>
                {emptyMessage ? <p className="mt-2 text-base leading-6">{emptyMessage}</p> : null}
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
