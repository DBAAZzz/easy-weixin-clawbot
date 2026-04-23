import { useEffect, useMemo, useState } from "react";
import type { RsshubAuthType } from "@clawbot/shared";
import { testRssSettingsConnection } from "@/api/rss.js";
import { useAppSettings } from "../../hooks/useAppSettings.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { Input } from "../ui/input.js";
import { Select } from "../ui/select.js";
import { LinkIcon, RefreshIcon, SearchIcon } from "../ui/icons.js";
import { toast } from "../ui/sonner.js";
import { cn } from "../../lib/cn.js";

const AUTH_OPTIONS: Array<{ value: RsshubAuthType; label: string }> = [
  { value: "none", label: "无需认证" },
  { value: "basic", label: "Basic Auth" },
  { value: "bearer", label: "Bearer Token" },
];

export function RssSettingsPanel(props: { active: boolean }) {
  const { settings, loading, error, update } = useAppSettings(props.active);
  const [baseUrl, setBaseUrl] = useState("");
  const [authType, setAuthType] = useState<RsshubAuthType>("none");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [clearPassword, setClearPassword] = useState(false);
  const [bearerToken, setBearerToken] = useState("");
  const [clearBearerToken, setClearBearerToken] = useState(false);
  const [timeoutMs, setTimeoutMs] = useState("15000");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<Awaited<
    ReturnType<typeof testRssSettingsConnection>
  > | null>(null);

  useEffect(() => {
    if (!props.active || !settings) {
      return;
    }

    setBaseUrl(settings.rsshub_base_url ?? "");
    setAuthType(settings.rsshub_auth_type);
    setUsername(settings.rsshub_username ?? "");
    setPassword("");
    setClearPassword(false);
    setBearerToken("");
    setClearBearerToken(false);
    setTimeoutMs(String(settings.rss_request_timeout_ms));
    setSaveError(null);
    setTestResult(null);
  }, [props.active, settings]);

  const parsedTimeout = Number.parseInt(timeoutMs, 10);
  const isValidTimeout = Number.isInteger(parsedTimeout) && parsedTimeout >= 1000;

  const isDirty = useMemo(() => {
    if (!settings) {
      return false;
    }

    return (
      baseUrl.trim() !== (settings.rsshub_base_url ?? "") ||
      authType !== settings.rsshub_auth_type ||
      username.trim() !== (settings.rsshub_username ?? "") ||
      password.trim().length > 0 ||
      clearPassword ||
      bearerToken.trim().length > 0 ||
      clearBearerToken ||
      parsedTimeout !== settings.rss_request_timeout_ms
    );
  }, [
    authType,
    baseUrl,
    bearerToken,
    clearBearerToken,
    clearPassword,
    parsedTimeout,
    password,
    settings,
    username,
  ]);

  async function handleSave() {
    if (!isValidTimeout) {
      setSaveError("请求超时必须是大于等于 1000 的整数毫秒值");
      return;
    }

    setSaving(true);
    setSaveError(null);

    try {
      const payload: Partial<{
        normal_rate: number;
        rsshub_base_url: string | null;
        rsshub_auth_type: "none" | "basic" | "bearer";
        rsshub_username: string | null;
        rsshub_password: string | null;
        rsshub_bearer_token: string | null;
        rss_request_timeout_ms: number;
      }> = {
        rsshub_base_url: baseUrl.trim() || null,
        rsshub_auth_type: authType,
        rss_request_timeout_ms: parsedTimeout,
      };

      if (authType === "basic") {
        payload.rsshub_username = username.trim() || null;

        if (clearPassword) {
          payload.rsshub_password = null;
        } else if (password.trim()) {
          payload.rsshub_password = password.trim();
        } else if (!settings?.rsshub_password_set) {
          payload.rsshub_password = null;
        }

        payload.rsshub_bearer_token = null;
      } else if (authType === "bearer") {
        payload.rsshub_username = null;
        payload.rsshub_password = null;

        if (clearBearerToken) {
          payload.rsshub_bearer_token = null;
        } else if (bearerToken.trim()) {
          payload.rsshub_bearer_token = bearerToken.trim();
        } else if (!settings?.rsshub_bearer_token_set) {
          payload.rsshub_bearer_token = null;
        }
      } else {
        payload.rsshub_username = null;
        payload.rsshub_password = null;
        payload.rsshub_bearer_token = null;
      }

      await update(payload);
      setPassword("");
      setClearPassword(false);
      setBearerToken("");
      setClearBearerToken(false);
      toast.success("RSS 设置已保存");
    } catch (saveIssue) {
      const message = saveIssue instanceof Error ? saveIssue.message : "保存失败";
      setSaveError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    setSaveError(null);

    try {
      const result = await testRssSettingsConnection();
      setTestResult(result);
      if (result.reachable) {
        toast.success("RSSHub 连接测试成功");
      } else {
        toast.error(result.message);
      }
    } catch (testIssue) {
      const message = testIssue instanceof Error ? testIssue.message : "测试失败";
      setSaveError(message);
      toast.error(message);
    } finally {
      setTesting(false);
    }
  }

  return (
    <section className={cn("flex h-full min-w-0 flex-col", !props.active && "hidden")}>
      <header className="border-b border-line px-5 py-4 md:px-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex min-w-0 flex-col gap-1">
            <h3 className="text-2xl font-semibold text-ink">RSS</h3>
            <p className="text-base leading-6 text-muted-strong">
              管理 RSSHub 地址、认证方式和抓取超时。
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={settings?.rsshub_base_url ? "online" : "offline"}>
              {settings?.rsshub_base_url ? "已配置 RSSHub" : "未配置 RSSHub"}
            </Badge>
            {settings?.rsshub_password_set ? <Badge tone="muted">已保存密码</Badge> : null}
            {settings?.rsshub_bearer_token_set ? <Badge tone="muted">已保存 Token</Badge> : null}
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-5 py-5 md:px-6">
        <div className="flex flex-col gap-4">
          {error ? (
            <div className="rounded-panel border border-notice-error-border bg-notice-error-bg px-4 py-3 text-base leading-6 text-red-700">
              加载 RSS 设置失败：{error}
            </div>
          ) : null}

          {loading ? (
            <div className="rounded-panel border border-line bg-pane-74 px-4 py-3 text-base text-muted-strong">
              正在加载 RSS 设置…
            </div>
          ) : null}

          <section className="rounded-panel border border-line bg-panel px-4 py-4 shadow-card md:px-5 md:py-5">
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-3">
                <span className="flex size-10 items-center justify-center rounded-card border border-line bg-pane-95 text-accent shadow-btn-soft">
                  <LinkIcon className="size-4" />
                </span>
                <div>
                  <h4 className="text-2xl font-semibold text-ink">RSSHub 与抓取设置</h4>
                  <p className="text-base leading-6 text-muted-strong">
                    RSSHub 路由源会复用这里的统一配置。
                  </p>
                </div>
              </div>

              <div className="flex flex-col gap-2.5">
                <label className="text-base font-medium text-muted-strong">RSSHub Base URL</label>
                <Input
                  value={baseUrl}
                  onChange={(event) => setBaseUrl(event.target.value)}
                  placeholder="例如 https://rsshub.app"
                />
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <div className="flex flex-col gap-2.5">
                  <label className="text-base font-medium text-muted-strong">认证方式</label>
                  <Select
                    value={authType}
                    onChange={(value) => setAuthType(value as RsshubAuthType)}
                    options={AUTH_OPTIONS}
                  />
                </div>

                <div className="flex flex-col gap-2.5">
                  <label className="text-base font-medium text-muted-strong">
                    请求超时（毫秒）
                  </label>
                  <Input
                    type="number"
                    value={timeoutMs}
                    onChange={(event) => setTimeoutMs(event.target.value)}
                    placeholder="15000"
                  />
                </div>
              </div>

              {authType === "basic" ? (
                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="flex flex-col gap-2.5">
                    <label className="text-base font-medium text-muted-strong">用户名</label>
                    <Input
                      value={username}
                      onChange={(event) => setUsername(event.target.value)}
                      placeholder="Basic Auth 用户名"
                    />
                  </div>

                  <div className="flex flex-col gap-2.5">
                    <label className="text-base font-medium text-muted-strong">密码</label>
                    <Input
                      type="password"
                      value={password}
                      onChange={(event) => {
                        setPassword(event.target.value);
                        if (event.target.value) {
                          setClearPassword(false);
                        }
                      }}
                      placeholder={
                        settings?.rsshub_password_set ? "已设置，留空则不修改" : "Basic Auth 密码"
                      }
                    />
                    {settings?.rsshub_password_set ? (
                      <div className="flex items-center justify-between gap-3 text-sm text-muted-strong">
                        <span>{clearPassword ? "保存后将清空已保存密码" : "当前已保存密码"}</span>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setClearPassword((current) => !current);
                            setPassword("");
                          }}
                        >
                          {clearPassword ? "撤销清空" : "清空密码"}
                        </Button>
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {authType === "bearer" ? (
                <div className="flex flex-col gap-2.5">
                  <label className="text-base font-medium text-muted-strong">Bearer Token</label>
                  <Input
                    type="password"
                    value={bearerToken}
                    onChange={(event) => {
                      setBearerToken(event.target.value);
                      if (event.target.value) {
                        setClearBearerToken(false);
                      }
                    }}
                    placeholder={
                      settings?.rsshub_bearer_token_set ? "已设置，留空则不修改" : "Bearer Token"
                    }
                  />
                  {settings?.rsshub_bearer_token_set ? (
                    <div className="flex items-center justify-between gap-3 text-sm text-muted-strong">
                      <span>
                        {clearBearerToken ? "保存后将清空已保存 Token" : "当前已保存 Token"}
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setClearBearerToken((current) => !current);
                          setBearerToken("");
                        }}
                      >
                        {clearBearerToken ? "撤销清空" : "清空 Token"}
                      </Button>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </section>

          {testResult ? (
            <section className="rounded-panel border border-line bg-panel px-4 py-4 shadow-card md:px-5 md:py-5">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={testResult.reachable ? "online" : "error"}>
                  {testResult.reachable ? "连接可用" : "连接失败"}
                </Badge>
                {testResult.status_code ? (
                  <Badge tone="muted">状态码 {testResult.status_code}</Badge>
                ) : null}
                {testResult.latency_ms !== null ? (
                  <Badge tone="muted">延迟 {testResult.latency_ms}ms</Badge>
                ) : null}
              </div>
              <p className="mt-3 text-base leading-6 text-muted-strong">{testResult.message}</p>
            </section>
          ) : null}

          {saveError ? (
            <div className="rounded-panel border border-notice-error-border bg-notice-error-bg px-4 py-3 text-base leading-6 text-red-700">
              {saveError}
            </div>
          ) : null}

          <div className="flex flex-wrap justify-end gap-2 pt-2">
            <Button
              variant="outline"
              disabled={testing || loading}
              onClick={() => void handleTest()}
            >
              <SearchIcon data-icon="inline-start" />
              {testing ? "测试中..." : "测试连接"}
            </Button>
            <Button variant="outline" disabled={loading} onClick={() => setTestResult(null)}>
              <RefreshIcon data-icon="inline-start" />
              清空结果
            </Button>
            <Button
              disabled={saving || loading || !isDirty || !isValidTimeout}
              onClick={() => void handleSave()}
            >
              {saving ? "保存中..." : "保存"}
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
