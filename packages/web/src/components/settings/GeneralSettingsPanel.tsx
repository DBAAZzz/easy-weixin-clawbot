import { useEffect, useMemo, useState } from "react";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { Slider } from "../ui/slider.js";
import { toast } from "../ui/sonner.js";
import { cn } from "../../lib/cn.js";
import { useAppSettings } from "../../hooks/useAppSettings.js";

function formatRateLabel(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatRateInput(value: number): string {
  return value.toString();
}

export function GeneralSettingsPanel(props: { active: boolean }) {
  const [normalRateDraft, setNormalRateDraft] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const { settings, loading, error, update } = useAppSettings(props.active);

  useEffect(() => {
    if (!props.active || !settings) {
      return;
    }

    setSaveError(null);
    setNormalRateDraft(formatRateInput(settings.normal_rate));
  }, [props.active, settings]);

  const trimmedDraft = normalRateDraft.trim();
  const parsedDraft = Number.parseFloat(trimmedDraft);
  const isValidDraft =
    trimmedDraft.length > 0 && Number.isFinite(parsedDraft) && parsedDraft >= 0 && parsedDraft <= 1;

  const isDirty = useMemo(() => {
    if (!settings || !isValidDraft) {
      return false;
    }

    return Math.abs(parsedDraft - settings.normal_rate) > 0.000_001;
  }, [isValidDraft, parsedDraft, settings]);

  const previewRate = isValidDraft ? parsedDraft : (settings?.normal_rate ?? 0);

  async function handleSave() {
    if (!isValidDraft) {
      setSaveError("normalRate 必须是 0 到 1 之间的数字");
      return;
    }

    setSaving(true);
    setSaveError(null);

    try {
      const result = await update({ normal_rate: parsedDraft });
      setNormalRateDraft(formatRateInput(result.normal_rate));
      toast.success("通用设置已保存");
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
            <h3 className="text-2xl font-semibold text-ink">通用</h3>
            <p className="text-base leading-6 text-muted-strong">修改后立即生效。</p>
          </div>

          <Badge tone="muted">当前 {formatRateLabel(previewRate)}</Badge>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-5 py-5 md:px-6">
        <div className="flex flex-col gap-4">
          {error ? (
            <div className="rounded-panel border border-notice-error-border bg-notice-error-bg px-4 py-3 text-base leading-6 text-red-700">
              加载通用设置失败：{error}
            </div>
          ) : null}

          {loading ? (
            <div className="rounded-panel border border-line bg-pane-74 px-4 py-3 text-base text-muted-strong">
              正在加载通用设置…
            </div>
          ) : null}

          <section className="rounded-panel border border-line bg-panel px-4 py-4 shadow-card md:px-5 md:py-5">
            <div className="flex flex-col gap-5">
              <div className="flex min-w-0 flex-col gap-1">
                <h4 className="text-2xl font-semibold text-ink">normalRate</h4>
                <p className="text-base leading-6 text-muted-strong">
                  普通 trace 的采样率，范围 0 到 1。
                </p>
              </div>

              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <label className="text-base font-medium text-muted-strong">采样率</label>
                  <span className="text-base font-semibold text-accent">
                    {formatRateLabel(previewRate)}
                  </span>
                </div>
                <Slider
                  value={previewRate}
                  min={0}
                  max={1}
                  step={0.05}
                  onValueChange={(value) => {
                    setNormalRateDraft(value.toString());
                    if (saveError) {
                      setSaveError(null);
                    }
                  }}
                />
                <p className="text-sm leading-6 text-muted-strong">
                  0 表示只保留强制保留的 trace，1 表示保留全部普通 trace。
                </p>
              </div>

              {saveError ? (
                <div className="rounded-panel border border-notice-error-border bg-notice-error-bg px-4 py-3 text-base leading-6 text-red-700">
                  {saveError}
                </div>
              ) : null}

              <div className="flex flex-col gap-3 pt-2 md:flex-row md:items-center md:justify-between">
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    disabled={!settings || saving}
                    onClick={() => {
                      if (!settings) {
                        return;
                      }

                      setSaveError(null);
                      setNormalRateDraft(formatRateInput(settings.normal_rate));
                    }}
                  >
                    重置
                  </Button>
                  <Button
                    disabled={loading || saving || !isDirty || !isValidDraft}
                    onClick={() => void handleSave()}
                  >
                    {saving ? "保存中..." : "保存"}
                  </Button>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </section>
  );
}
