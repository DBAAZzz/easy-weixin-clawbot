import { useState } from "react";
import {
  Badge,
  Button,
  ConfirmDialog,
  CopyIcon,
  DialogAction,
  DialogFrame,
  DialogMetaItem,
  DialogParamItem,
  DialogSidebarSection,
  SplitDialog,
  TerminalIcon,
  type BadgeTone,
  type DialogLayout,
  type DialogTone,
} from "@clawbot/ui";
import { StoryBook, useControls } from "../../Playground/index.js";

const badgeToneByTone: Record<DialogTone, BadgeTone> = {
  accent: "online",
  success: "online",
  danger: "error",
  neutral: "muted",
};

export default function Demo() {
  const [open, setOpen] = useState(false);
  const controls = useControls({
    preset: {
      options: ["SplitDialog", "DialogFrame", "ConfirmDialog"],
      value: "SplitDialog",
    },
    layout: {
      options: ["dialog", "panel"],
      value: "panel",
    },
    tone: {
      options: ["accent", "success", "danger", "neutral"],
      value: "accent",
    },
    title: "opencli",
    subtitle: "外部能力 · 工具调用 handler",
    status: false,
    icon: true,
  });

  const layout = controls.layout as DialogLayout;
  const tone = controls.tone as DialogTone;
  const icon = controls.icon ? <TerminalIcon /> : undefined;
  const statusBadge = controls.status ? (
    <Badge tone={badgeToneByTone[tone]}>已启用</Badge>
  ) : undefined;

  const mainContent = (
    <div className="ui-demo-dialog-stack">
      <section className="ui-demo-dialog-section">
        <h3 className="ui-demo-dialog-heading">说明</h3>
        <p className="ui-demo-dialog-copy">
          调用 opencli 执行网站、桌面应用和外部 CLI 能力。命令格式为{" "}
          <code className="ui-demo-dialog-code ui-demo-dialog-code--accent">
            &lt;site&gt; &lt;command&gt; [--options]
          </code>
          ，不需要带 <code className="ui-demo-dialog-code">opencli</code>{" "}
          前缀。需要结构化输出时优先追加 <code className="ui-demo-dialog-code">-f json</code>。
        </p>
      </section>

      <section className="ui-demo-dialog-section">
        <div className="ui-demo-dialog-header-row">
          <div className="ui-demo-dialog-header-title">
            <h3 className="ui-demo-dialog-heading">参数快照</h3>
            <span className="ui-demo-dialog-pill">只读</span>
          </div>
          <DialogAction>
            <CopyIcon />
            复制
          </DialogAction>
        </div>

        <pre className="ui-demo-dialog-pre">
          {`{
  "handler": "cli",
  "parameters": [
    "command"
  ]
}`}
        </pre>
      </section>
    </div>
  );

  const sidebar = (
    <>
      <DialogSidebarSection title="元信息">
        <dl className="ui-demo-dialog-description-list">
          <DialogMetaItem label="Handler" value="cli" mono />
          <DialogMetaItem label="来源" value="代码内置" />
          <DialogMetaItem label="状态" value={statusBadge} />
        </dl>
      </DialogSidebarSection>
      <DialogSidebarSection title="输入参数">
        <DialogParamItem name="command" required />
      </DialogSidebarSection>
    </>
  );

  const footer = (
    <div className="ui-demo-dialog-footer">
      <DialogAction closeOnClick>关闭</DialogAction>
    </div>
  );

  return (
    <StoryBook>
      <Button onClick={() => setOpen(true)}>打开弹窗</Button>
      {controls.preset === "SplitDialog" ? (
        <SplitDialog
          description={controls.subtitle}
          footer={footer}
          footerMeta="最近更新 · 2026/06/14"
          icon={icon}
          onOpenChange={setOpen}
          open={open}
          sidebar={sidebar}
          status={statusBadge}
          title={controls.title}
          tone={tone}
        >
          {mainContent}
        </SplitDialog>
      ) : null}

      {controls.preset === "DialogFrame" ? (
        <DialogFrame
          description={controls.subtitle}
          footer={
            <div className="ui-demo-dialog-footer">
              <DialogAction closeOnClick>取消</DialogAction>
              <DialogAction closeOnClick variant={tone === "danger" ? "danger" : "primary"}>
                保存
              </DialogAction>
            </div>
          }
          icon={icon}
          layout={layout}
          onOpenChange={setOpen}
          open={open}
          status={statusBadge}
          title={controls.title}
          tone={tone}
        >
          <p>
            DialogFrame 负责外壳、遮罩、关闭按钮、头部、内容区和 footer
            编排。调用方只需要传入业务内容。
          </p>
        </DialogFrame>
      ) : null}

      {controls.preset === "ConfirmDialog" ? (
        <ConfirmDialog
          cancelText="取消"
          confirmText="确定"
          description="此操作会立即生效，请确认是否继续。"
          icon={icon}
          onOpenChange={setOpen}
          open={open}
          status={statusBadge}
          title={tone === "danger" ? "确认危险操作" : "确认操作"}
          tone={tone}
        >
          <p>ConfirmDialog 内建取消和确认操作，适合删除、启停、提交等短确认场景。</p>
        </ConfirmDialog>
      ) : null}
    </StoryBook>
  );
}
