import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  CardActionButton,
  CardOverflowMenu,
  CardToggle,
  IconTag,
  MetricGrid,
} from "../src/components/ui/admin-card.tsx";
import { ActivityIcon } from "../src/components/ui/icons.tsx";

test("MetricGrid renders icon labels and values", () => {
  const markup = renderToStaticMarkup(
    <MetricGrid
      items={[
        {
          icon: <ActivityIcon className="size-3.5" />,
          label: "运行次数",
          value: "12 次",
        },
      ]}
    />,
  );

  assert.match(markup, /运行次数/);
  assert.match(markup, /12 次/);
});

test("CardToggle exposes enabled state through aria-pressed", () => {
  const markup = renderToStaticMarkup(
    <CardToggle enabled busy={false} label="启用卡片" onToggle={() => {}} />,
  );

  assert.match(markup, /aria-pressed="true"/);
});

test("IconTag renders prefixed content", () => {
  const markup = renderToStaticMarkup(
    <IconTag icon={<ActivityIcon className="size-3" />}>运行中</IconTag>,
  );

  assert.match(markup, /运行中/);
});

test("CardActionButton applies danger emphasis class", () => {
  const markup = renderToStaticMarkup(
    <CardActionButton
      label="删除"
      tone="danger"
      onClick={() => {}}
      icon={<ActivityIcon className="size-4" />}
    />,
  );

  assert.match(markup, /text-red-500/);
});

test("CardOverflowMenu renders more actions trigger", () => {
  const markup = renderToStaticMarkup(
    <CardOverflowMenu
      items={[
        {
          label: "查看日志",
          onClick: () => {},
          icon: <ActivityIcon className="size-4" />,
        },
      ]}
    />,
  );

  assert.match(markup, /aria-label="更多操作"/);
});
