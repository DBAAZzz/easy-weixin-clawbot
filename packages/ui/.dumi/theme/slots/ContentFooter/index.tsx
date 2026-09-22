import {
  FormattedMessage,
  Link,
  useLocation,
  useRouteMeta,
  useSidebarData,
  useSiteData,
} from "dumi";
import { useLayoutEffect, useState, type ReactNode } from "react";
import "../../style.css";

type FooterLink = {
  title: ReactNode;
  link: string;
};

function ArrowIcon({ direction }: { direction: "prev" | "next" }) {
  return (
    <svg
      className="clawbot-content-footer__arrow"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      data-direction={direction}
    >
      {direction === "prev" ? (
        <path
          d="M13.8 8H3.2m3.4-3.4L3.2 8l3.4 3.4"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : (
        <path
          d="M2.2 8h10.6M9.4 4.6 12.8 8 9.4 11.4"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}

export default function ContentFooter() {
  const { pathname } = useLocation();
  const sidebar = useSidebarData();
  const { themeConfig } = useSiteData();
  const { frontmatter } = useRouteMeta();
  const [links, setLinks] = useState<{ prev?: FooterLink; next?: FooterLink }>({});
  const [lastUpdated, setLastUpdated] = useState<{ iso: string; text: string }>();

  useLayoutEffect(() => {
    if (!sidebar) {
      setLinks({});
      return;
    }
    const items = sidebar.reduce<FooterLink[]>((acc, group) => acc.concat(group.children), []);
    const current = items.findIndex((item) => item.link === pathname);
    setLinks({ prev: items[current - 1], next: items[current + 1] });
  }, [pathname, sidebar]);

  // 与服务端渲染的时间戳解耦，避免 hydration mismatch（同 dumi 默认实现）
  useLayoutEffect(() => {
    const raw = themeConfig.lastUpdated ? frontmatter.lastUpdated : undefined;

    if (raw) {
      setLastUpdated({
        iso: new Date(raw).toISOString(),
        text: new Intl.DateTimeFormat(undefined, {
          dateStyle: "short",
          timeStyle: "short",
        }).format(new Date(raw)),
      });
    } else {
      setLastUpdated(undefined);
    }
  }, [frontmatter.lastUpdated, themeConfig.lastUpdated]);

  if (!links.prev && !links.next && !lastUpdated) {
    return null;
  }

  return (
    <footer className="clawbot-content-footer">
      {lastUpdated ? (
        <p className="clawbot-content-footer__meta">
          <FormattedMessage id="content.footer.last.updated" />
          <time dateTime={lastUpdated.iso}>{lastUpdated.text}</time>
        </p>
      ) : null}
      {links.prev || links.next ? (
        <nav className="clawbot-content-footer__nav" aria-label="上一篇 / 下一篇">
          {links.prev ? (
            <Link
              to={links.prev.link}
              rel="prev"
              className="clawbot-content-footer__link"
              data-direction="prev"
            >
              <ArrowIcon direction="prev" />
              <span className="clawbot-content-footer__text">
                <small>
                  <FormattedMessage id="content.footer.actions.previous" />
                </small>
                <strong>{links.prev.title}</strong>
              </span>
            </Link>
          ) : null}
          {links.next ? (
            <Link
              to={links.next.link}
              rel="next"
              className="clawbot-content-footer__link"
              data-direction="next"
            >
              <span className="clawbot-content-footer__text">
                <small>
                  <FormattedMessage id="content.footer.actions.next" />
                </small>
                <strong>{links.next.title}</strong>
              </span>
              <ArrowIcon direction="next" />
            </Link>
          ) : null}
        </nav>
      ) : null}
    </footer>
  );
}
