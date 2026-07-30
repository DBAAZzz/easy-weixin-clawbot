import { Link, useFullSidebarData } from "dumi";
import { useEffect, useMemo } from "react";
import "./style.css";

type CatalogItem = {
  category: string;
  link: string;
  title: string;
};

const CATEGORY_ORDER = ["基础组件", "表单组件", "反馈组件", "展示组件", "布局组件", "业务组件"];

const CATEGORY_DESCRIPTIONS: Record<string, string> = {
  业务组件: "沉淀 Clawbot 后台中稳定复用的业务结构。",
  反馈组件: "确认重要操作并反馈系统结果。",
  基础组件: "构成界面的通用动作、状态与导航元素。",
  展示组件: "组织辅助信息并呈现数据趋势。",
  布局组件: "建立局部内容边界与滚动区域。",
  表单组件: "输入、选择和调整配置值。",
  其他: "尚未归类的组件文档。",
};

function getFrontmatterGroup(group: unknown) {
  if (typeof group === "string") {
    return group;
  }

  if (group && typeof group === "object" && "title" in group) {
    const title = (group as { title?: unknown }).title;
    return typeof title === "string" ? title : undefined;
  }

  return undefined;
}

export default function HomePage() {
  const sidebarByNav = useFullSidebarData();

  const catalogItems = useMemo(() => {
    const itemsByLink = new Map<string, CatalogItem>();

    for (const groups of Object.values(sidebarByNav)) {
      for (const group of groups) {
        for (const child of group.children) {
          if (!child.link.startsWith("/components/")) {
            continue;
          }

          itemsByLink.set(child.link, {
            category: getFrontmatterGroup(child.frontmatter?.group) ?? group.title ?? "其他",
            link: child.link,
            title: child.title,
          });
        }
      }
    }

    return [...itemsByLink.values()].sort((left, right) =>
      left.title.localeCompare(right.title, "en"),
    );
  }, [sidebarByNav]);

  const categories = useMemo(() => {
    const categoryNames = new Set(catalogItems.map((item) => item.category));
    const orderedNames = [
      ...CATEGORY_ORDER.filter((category) => categoryNames.has(category)),
      ...[...categoryNames].filter((category) => !CATEGORY_ORDER.includes(category)).sort(),
    ];

    return orderedNames.map((category) => ({
      description: CATEGORY_DESCRIPTIONS[category] ?? CATEGORY_DESCRIPTIONS.其他,
      items: catalogItems.filter((item) => item.category === category),
      title: category,
    }));
  }, [catalogItems]);

  const unclassifiedItems = useMemo(
    () => catalogItems.filter((item) => item.category === "其他"),
    [catalogItems],
  );

  useEffect(() => {
    if (process.env.NODE_ENV !== "production" && unclassifiedItems.length > 0) {
      console.warn(
        `[Clawbot UI docs] Components without a frontmatter group: ${unclassifiedItems
          .map((item) => item.title)
          .join(", ")}`,
      );
    }
  }, [unclassifiedItems]);

  return (
    <div className="clawbot-home">
      <section className="clawbot-home-hero">
        <div className="clawbot-home-grid" aria-hidden="true" />
        <span className="clawbot-home-cross clawbot-home-cross--left" aria-hidden="true" />
        <span className="clawbot-home-cross clawbot-home-cross--right" aria-hidden="true" />

        <div className="clawbot-home-hero-copy">
          <p className="clawbot-home-kicker">
            <strong>公开文档</strong>为 Clawbot 仓库内部开发而设计
          </p>
          <h1>
            为 Agent 后台构建
            <br />
            清晰、可靠的界面。
          </h1>
          <p className="clawbot-home-lede">
            一套面向复杂管理场景的 React 组件与交互约定，让每个
            Agent、每项配置和每次反馈都保持一致。
          </p>
          <a className="clawbot-home-cta" href="#components">
            <span aria-hidden="true">✦</span>
            浏览全部组件
            <span aria-hidden="true">→</span>
          </a>
        </div>

        <div className="clawbot-home-stage" aria-hidden="true">
          <div className="clawbot-home-beam clawbot-home-beam--left" />
          <div className="clawbot-home-beam clawbot-home-beam--right" />
          <div className="clawbot-home-glow" />
          <div className="clawbot-home-connector" />
          <span className="clawbot-home-node clawbot-home-node--one">B</span>
          <span className="clawbot-home-node clawbot-home-node--two">◉</span>
          <span className="clawbot-home-node clawbot-home-node--three">↗</span>
          <span className="clawbot-home-node clawbot-home-node--four">⌁</span>

          <div className="clawbot-home-workbench">
            <div className="clawbot-home-window-bar">
              <span className="clawbot-home-window-dots">
                <i />
                <i />
                <i />
              </span>
              <span>Clawbot UI · Component Playground</span>
              <small>React 19</small>
            </div>
            <div className="clawbot-home-workbench-body">
              <div className="clawbot-home-workbench-sidebar">
                <small>Components</small>
                <span className="is-active">Overview</span>
                <span>Data Entry</span>
                <span>Feedback</span>
                <span>Display</span>
              </div>
              <div className="clawbot-home-workbench-main">
                <div className="clawbot-home-workbench-title">
                  <strong>Agent controls</strong>
                  <small>Live preview</small>
                </div>
                <div className="clawbot-home-samples">
                  <div className="clawbot-home-sample-panel">
                    <small>Actions &amp; states</small>
                    <div className="clawbot-home-button-row">
                      <span className="is-primary">创建 Agent</span>
                      <span>取消</span>
                      <span>更多</span>
                    </div>
                    <div className="clawbot-home-badge-row">
                      <span className="is-online">● 在线</span>
                      <span>默认配置</span>
                    </div>
                    <div className="clawbot-home-switch-row">
                      <span>启用自动回复</span>
                      <i />
                    </div>
                  </div>
                  <div className="clawbot-home-agent-card">
                    <span className="clawbot-home-avatar">AI</span>
                    <strong>运营助手</strong>
                    <small>运行正常 · 最近活动 2 分钟前</small>
                    <i className="clawbot-home-pulse" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <aside className="clawbot-home-availability">
        <p>
          <strong>公开阅读，内部使用。</strong>
          文档对外开放，组件包当前仅在 Clawbot monorepo 内分发。
        </p>
        <code>@clawbot/ui · private</code>
      </aside>

      <section className="clawbot-home-catalog" id="components">
        <p className="clawbot-home-section-label">Component catalog</p>
        <div className="clawbot-home-catalog-heading">
          <h2>从动作到反馈，快速找到合适的组件。</h2>
          <p>首页负责发现，组件页负责用法、示例与 API 契约。</p>
        </div>

        <div className="clawbot-home-categories">
          {categories.map((category) => (
            <article className="clawbot-home-category" key={category.title}>
              <header>
                <h3>{category.title}</h3>
                <span>{String(category.items.length).padStart(2, "0")}</span>
              </header>
              <p>{category.description}</p>
              <div className="clawbot-home-component-links">
                {category.items.map((item) => (
                  <Link key={item.link} to={item.link}>
                    {item.title}
                    <span aria-hidden="true">↗</span>
                  </Link>
                ))}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="clawbot-home-principle">
        <div className="clawbot-home-principle-grid" aria-hidden="true" />
        <div className="clawbot-home-principle-glow" aria-hidden="true" />
        <div>
          <p className="clawbot-home-section-label">Design principle</p>
          <h2>
            让复杂留在系统里，
            <br />
            让界面保持安静。
          </h2>
          <p>
            Clawbot UI 用清晰的层级、克制的边界和一致的状态语义，承载多账号、多 Agent
            与多工具协作的复杂度。
          </p>
        </div>
      </section>

      <footer className="clawbot-home-footer">
        <div>
          <p className="clawbot-home-footer-brand">
            <span aria-hidden="true">✦</span>
            Clawbot UI
          </p>
          <p>微信 ClawBot Agent 管理后台的 React 组件库。文档公开，组件包仅供仓库内部使用。</p>
        </div>
        <nav aria-label="页脚导航">
          <strong>文档</strong>
          <Link to="/">首页</Link>
          <Link to="/components/button">组件目录</Link>
        </nav>
        <div>
          <strong>技术栈</strong>
          <span>React 19</span>
          <span>Base UI</span>
          <span>dumi</span>
        </div>
      </footer>
    </div>
  );
}
