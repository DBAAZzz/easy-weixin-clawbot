import { useEffect, useMemo, useState } from "react";
import type { AssetStorageProvider } from "@clawbot/shared";
import { useAppSettings } from "../../hooks/useAppSettings.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { Input } from "../ui/input.js";
import { Select } from "../ui/select.js";
import { StackIcon } from "../ui/icons.js";
import { toast } from "../ui/sonner.js";
import { cn } from "../../lib/cn.js";

const STORAGE_OPTIONS: Array<{ value: AssetStorageProvider; label: string }> = [
  { value: "local", label: "本地 data/assets" },
  { value: "s3-compatible", label: "Cloudflare R2 / S3-compatible" },
];

export function AssetStorageSettingsPanel(props: { active: boolean }) {
  const { settings, loading, error, update } = useAppSettings(props.active);
  const [provider, setProvider] = useState<AssetStorageProvider>("local");
  const [localBaseDir, setLocalBaseDir] = useState("");
  const [s3Name, setS3Name] = useState("cloudflare-r2");
  const [s3Endpoint, setS3Endpoint] = useState("");
  const [s3Region, setS3Region] = useState("auto");
  const [s3Bucket, setS3Bucket] = useState("");
  const [s3AccessKeyId, setS3AccessKeyId] = useState("");
  const [s3SecretAccessKey, setS3SecretAccessKey] = useState("");
  const [clearS3SecretAccessKey, setClearS3SecretAccessKey] = useState(false);
  const [s3PublicBaseUrl, setS3PublicBaseUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!props.active || !settings) {
      return;
    }

    setProvider(settings.asset_storage_provider);
    setLocalBaseDir(settings.asset_local_base_dir ?? "");
    setS3Name(settings.asset_s3_name ?? "cloudflare-r2");
    setS3Endpoint(settings.asset_s3_endpoint ?? "");
    setS3Region(settings.asset_s3_region ?? "auto");
    setS3Bucket(settings.asset_s3_bucket ?? "");
    setS3AccessKeyId(settings.asset_s3_access_key_id ?? "");
    setS3SecretAccessKey("");
    setClearS3SecretAccessKey(false);
    setS3PublicBaseUrl(settings.asset_s3_public_base_url ?? "");
    setSaveError(null);
  }, [props.active, settings]);

  const accessKeyIdChanged =
    Boolean(settings) && s3AccessKeyId.trim() !== (settings?.asset_s3_access_key_id ?? "");
  const hasUsableS3Secret =
    s3SecretAccessKey.trim().length > 0 ||
    (Boolean(settings?.asset_s3_secret_access_key_set) && !accessKeyIdChanged);
  const hasRequiredS3Fields =
    provider !== "s3-compatible" ||
    (s3Endpoint.trim().length > 0 &&
      s3Bucket.trim().length > 0 &&
      s3AccessKeyId.trim().length > 0 &&
      hasUsableS3Secret &&
      !clearS3SecretAccessKey);

  const isDirty = useMemo(() => {
    if (!settings) {
      return false;
    }

    return (
      provider !== settings.asset_storage_provider ||
      localBaseDir.trim() !== (settings.asset_local_base_dir ?? "") ||
      s3Name.trim() !== (settings.asset_s3_name ?? "cloudflare-r2") ||
      s3Endpoint.trim() !== (settings.asset_s3_endpoint ?? "") ||
      s3Region.trim() !== (settings.asset_s3_region ?? "auto") ||
      s3Bucket.trim() !== (settings.asset_s3_bucket ?? "") ||
      s3AccessKeyId.trim() !== (settings.asset_s3_access_key_id ?? "") ||
      s3SecretAccessKey.trim().length > 0 ||
      clearS3SecretAccessKey ||
      s3PublicBaseUrl.trim() !== (settings.asset_s3_public_base_url ?? "")
    );
  }, [
    clearS3SecretAccessKey,
    localBaseDir,
    provider,
    s3AccessKeyId,
    s3Bucket,
    s3Endpoint,
    s3Name,
    s3PublicBaseUrl,
    s3Region,
    s3SecretAccessKey,
    settings,
  ]);

  async function handleSave() {
    if (provider === "s3-compatible" && !hasRequiredS3Fields) {
      setSaveError(
        accessKeyIdChanged
          ? "Access Key ID 改变时必须同时填写新的 Secret Access Key"
          : "启用 R2 时必须填写 endpoint、bucket、access key 和 secret key",
      );
      return;
    }

    setSaving(true);
    setSaveError(null);

    try {
      const payload = {
        asset_storage_provider: provider,
        asset_local_base_dir: localBaseDir.trim() || null,
        asset_s3_name: provider === "s3-compatible" ? s3Name.trim() || "cloudflare-r2" : null,
        asset_s3_endpoint: provider === "s3-compatible" ? s3Endpoint.trim() || null : null,
        asset_s3_region: provider === "s3-compatible" ? s3Region.trim() || "auto" : null,
        asset_s3_bucket: provider === "s3-compatible" ? s3Bucket.trim() || null : null,
        asset_s3_access_key_id: provider === "s3-compatible" ? s3AccessKeyId.trim() || null : null,
        asset_s3_public_base_url:
          provider === "s3-compatible" ? s3PublicBaseUrl.trim() || null : null,
        ...(provider === "s3-compatible" && clearS3SecretAccessKey
          ? { asset_s3_secret_access_key: null }
          : {}),
        ...(provider === "s3-compatible" && s3SecretAccessKey.trim()
          ? { asset_s3_secret_access_key: s3SecretAccessKey.trim() }
          : {}),
      };

      await update(payload);
      setS3SecretAccessKey("");
      setClearS3SecretAccessKey(false);
      toast.success("资产存储设置已保存");
    } catch (saveIssue) {
      const message = saveIssue instanceof Error ? saveIssue.message : "保存失败";
      setSaveError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className={cn("flex h-full min-w-0 flex-col", !props.active && "hidden")}>
      <header className="border-b border-line px-5 py-4 md:px-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex min-w-0 flex-col gap-1">
            <h3 className="text-2xl font-semibold text-ink">资产存储</h3>
            <p className="text-base leading-6 text-muted-strong">
              配置图片、视频、音频和文件的长期保存位置。
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={provider === "s3-compatible" ? "online" : "muted"}>
              {provider === "s3-compatible" ? "Cloudflare R2" : "本地存储"}
            </Badge>
            {settings?.asset_s3_secret_access_key_set ? (
              <Badge tone="muted">已保存 Secret</Badge>
            ) : null}
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-5 py-5 md:px-6">
        <div className="flex flex-col gap-4">
          {error ? (
            <div className="rounded-panel border border-notice-error-border bg-notice-error-bg px-4 py-3 text-base leading-6 text-red-700">
              加载资产存储设置失败：{error}
            </div>
          ) : null}

          {loading ? (
            <div className="rounded-panel border border-line bg-pane-74 px-4 py-3 text-base text-muted-strong">
              正在加载资产存储设置…
            </div>
          ) : null}

          <section className="rounded-panel border border-line bg-panel px-4 py-4 shadow-card md:px-5 md:py-5">
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-3">
                <span className="flex size-10 items-center justify-center rounded-card border border-line bg-pane-95 text-accent shadow-btn-soft">
                  <StackIcon className="size-4" />
                </span>
                <div>
                  <h4 className="text-2xl font-semibold text-ink">存储后端</h4>
                  <p className="text-base leading-6 text-muted-strong">
                    保存后新收到的媒体会写入所选存储；旧资产仍按原记录读取。
                  </p>
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <div className="flex flex-col gap-2.5">
                  <label className="text-base font-medium text-muted-strong">Provider</label>
                  <Select
                    value={provider}
                    onChange={(value) => setProvider(value as AssetStorageProvider)}
                    options={STORAGE_OPTIONS}
                  />
                </div>

                <div className="flex flex-col gap-2.5">
                  <label className="text-base font-medium text-muted-strong">
                    本地目录（可选）
                  </label>
                  <Input
                    value={localBaseDir}
                    onChange={(event) => setLocalBaseDir(event.target.value)}
                    placeholder="留空则使用 data/assets"
                  />
                </div>
              </div>
            </div>
          </section>

          {provider === "s3-compatible" ? (
            <section className="rounded-panel border border-line bg-panel px-4 py-4 shadow-card md:px-5 md:py-5">
              <div className="flex flex-col gap-4">
                <div className="flex min-w-0 flex-col gap-1">
                  <h4 className="text-2xl font-semibold text-ink">Cloudflare R2</h4>
                  <p className="text-base leading-6 text-muted-strong">
                    R2 使用 S3-compatible API。Endpoint 通常形如
                    https://账号ID.r2.cloudflarestorage.com。
                  </p>
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="flex flex-col gap-2.5">
                    <label className="text-base font-medium text-muted-strong">名称</label>
                    <Input
                      value={s3Name}
                      onChange={(event) => setS3Name(event.target.value)}
                      placeholder="cloudflare-r2"
                    />
                  </div>

                  <div className="flex flex-col gap-2.5">
                    <label className="text-base font-medium text-muted-strong">Region</label>
                    <Input
                      value={s3Region}
                      onChange={(event) => setS3Region(event.target.value)}
                      placeholder="auto"
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-2.5">
                  <label className="text-base font-medium text-muted-strong">Endpoint</label>
                  <Input
                    value={s3Endpoint}
                    onChange={(event) => setS3Endpoint(event.target.value)}
                    placeholder="https://<account-id>.r2.cloudflarestorage.com"
                  />
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="flex flex-col gap-2.5">
                    <label className="text-base font-medium text-muted-strong">Bucket</label>
                    <Input
                      value={s3Bucket}
                      onChange={(event) => setS3Bucket(event.target.value)}
                      placeholder="clawbot-assets"
                    />
                  </div>

                  <div className="flex flex-col gap-2.5">
                    <label className="text-base font-medium text-muted-strong">Access Key ID</label>
                    <Input
                      value={s3AccessKeyId}
                      onChange={(event) => setS3AccessKeyId(event.target.value)}
                      placeholder="R2 Access Key ID"
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-2.5">
                  <label className="text-base font-medium text-muted-strong">
                    Secret Access Key
                  </label>
                  <Input
                    type="password"
                    value={s3SecretAccessKey}
                    onChange={(event) => {
                      setS3SecretAccessKey(event.target.value);
                      if (event.target.value) {
                        setClearS3SecretAccessKey(false);
                      }
                    }}
                    placeholder={
                      settings?.asset_s3_secret_access_key_set
                        ? "已设置，留空则不修改"
                        : "R2 Secret Access Key"
                    }
                  />
                  {settings?.asset_s3_secret_access_key_set ? (
                    <div className="flex items-center justify-between gap-3 text-sm text-muted-strong">
                      <span>
                        {clearS3SecretAccessKey
                          ? "保存后将清空已保存 Secret"
                          : accessKeyIdChanged
                            ? "Access Key ID 已变化，请重新填写配套 Secret"
                            : "当前已保存 Secret"}
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setClearS3SecretAccessKey((current) => !current);
                          setS3SecretAccessKey("");
                        }}
                      >
                        {clearS3SecretAccessKey ? "撤销清空" : "清空 Secret"}
                      </Button>
                    </div>
                  ) : null}
                </div>

                <div className="flex flex-col gap-2.5">
                  <label className="text-base font-medium text-muted-strong">
                    Public Base URL（可选）
                  </label>
                  <Input
                    value={s3PublicBaseUrl}
                    onChange={(event) => setS3PublicBaseUrl(event.target.value)}
                    placeholder="https://assets.example.com"
                  />
                  <p className="text-sm leading-6 text-muted-strong">
                    留空时后端会生成短期签名 URL；配置公开域名后可直接返回 CDN URL。
                  </p>
                </div>
              </div>
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
              disabled={!settings || loading || saving}
              onClick={() => {
                if (!settings) {
                  return;
                }
                setProvider(settings.asset_storage_provider);
                setLocalBaseDir(settings.asset_local_base_dir ?? "");
                setS3Name(settings.asset_s3_name ?? "cloudflare-r2");
                setS3Endpoint(settings.asset_s3_endpoint ?? "");
                setS3Region(settings.asset_s3_region ?? "auto");
                setS3Bucket(settings.asset_s3_bucket ?? "");
                setS3AccessKeyId(settings.asset_s3_access_key_id ?? "");
                setS3SecretAccessKey("");
                setClearS3SecretAccessKey(false);
                setS3PublicBaseUrl(settings.asset_s3_public_base_url ?? "");
                setSaveError(null);
              }}
            >
              重置
            </Button>
            <Button
              disabled={saving || loading || !isDirty || !hasRequiredS3Fields}
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
