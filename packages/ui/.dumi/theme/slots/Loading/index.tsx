import "../../style.css";

/**
 * 路由级加载占位（umi 路由 Suspense 的 fallback）。
 * 路由 chunk 与首次进站加载期间替代白屏，形状对齐 DocLayout 的页头 / 侧栏 / 正文。
 */
export default function Loading() {
  return (
    <div aria-busy="true" className="clawbot-loading" role="status">
      <div className="clawbot-loading__header">
        <span className="clawbot-loading__logo clawbot-skeleton" />
        <span className="clawbot-loading__brand clawbot-skeleton" />
        <span className="clawbot-loading__nav">
          <i className="clawbot-skeleton" />
          <i className="clawbot-skeleton" />
          <i className="clawbot-skeleton" />
        </span>
        <span className="clawbot-loading__search clawbot-skeleton" />
      </div>
      <div className="clawbot-loading__body">
        <aside className="clawbot-loading__sidebar">
          <i className="clawbot-skeleton" />
          <i className="clawbot-skeleton" />
          <i className="clawbot-skeleton" />
          <i className="clawbot-skeleton" />
          <i className="clawbot-skeleton" />
          <i className="clawbot-skeleton" />
        </aside>
        <div className="clawbot-loading__article">
          <span className="clawbot-loading__title clawbot-skeleton" />
          <span className="clawbot-loading__lead clawbot-skeleton" />
          <span className="clawbot-loading__lead clawbot-skeleton" />
          <div className="clawbot-loading__canvas">
            <span className="clawbot-loading__pill clawbot-skeleton" />
            <span className="clawbot-loading__line clawbot-skeleton" />
            <span className="clawbot-loading__block clawbot-skeleton" />
          </div>
        </div>
      </div>
    </div>
  );
}
