import {
  Helmet,
  useIntl,
  useLocation,
  useOutlet,
  useRouteMeta,
  useSidebarData,
  useSiteData,
} from "dumi";
import ContentFooter from "dumi/theme-default/slots/ContentFooter";
import Features from "dumi/theme-default/slots/Features";
import Footer from "dumi/theme-default/slots/Footer";
import Header from "dumi/theme-default/slots/Header";
import Hero from "dumi/theme-default/slots/Hero";
import { useEffect, useState } from "react";
import Content from "../../slots/Content/index.js";
import Sidebar from "../../slots/Sidebar/index.js";
import Toc from "../../slots/Toc/index.js";
import "dumi/theme-default/layouts/DocLayout/index.less";
import "../../style.css";

export default function DocLayout() {
  const intl = useIntl();
  const outlet = useOutlet();
  const sidebar = useSidebarData();
  const { hash, pathname } = useLocation();
  const { loading, hostname } = useSiteData();
  const [activateSidebar, updateActivateSidebar] = useState(false);
  const { frontmatter, toc } = useRouteMeta();
  const showSidebar = frontmatter.sidebar !== false && Boolean(sidebar?.length);
  const showToc = frontmatter.toc !== false && toc.some((item) => item.depth > 1 && item.depth < 4);

  useEffect(() => {
    const id = hash.replace("#", "");

    if (id) {
      window.setTimeout(() => {
        const element = document.getElementById(decodeURIComponent(id));

        if (element) {
          window.scrollTo({ top: element.offsetTop - 80, behavior: "smooth" });
        }
      }, 1);
    }
  }, [hash, loading]);

  return (
    <div
      className="dumi-default-doc-layout"
      data-mobile-sidebar-active={activateSidebar || undefined}
      onClick={() => updateActivateSidebar(false)}
    >
      <Helmet>
        <html lang={intl.locale.replace(/-.+$/, "")} />
        {frontmatter.title ? <title>{frontmatter.title}</title> : null}
        {frontmatter.title ? <meta property="og:title" content={frontmatter.title} /> : null}
        {frontmatter.description ? (
          <meta name="description" content={frontmatter.description} />
        ) : null}
        {frontmatter.description ? (
          <meta property="og:description" content={frontmatter.description} />
        ) : null}
        {frontmatter.keywords ? (
          <meta name="keywords" content={frontmatter.keywords.join(",")} />
        ) : null}
        {frontmatter.keywords?.map((keyword) => (
          <meta key={keyword} property="article:tag" content={keyword} />
        ))}
        {hostname ? <link rel="canonical" href={hostname + pathname} /> : null}
      </Helmet>
      <Header />
      <Hero />
      <Features />
      {showSidebar ? (
        <div className="dumi-default-doc-layout-mobile-bar">
          <button
            type="button"
            className="dumi-default-sidebar-btn"
            onClick={(event) => {
              event.stopPropagation();
              updateActivateSidebar((value) => !value);
            }}
          >
            {intl.formatMessage({ id: "layout.sidebar.btn" })}
          </button>
        </div>
      ) : null}
      <main>
        {showSidebar ? <Sidebar /> : null}
        <Content>
          <article>{outlet}</article>
          <ContentFooter />
          <Footer />
        </Content>
        {showToc ? (
          <div className="dumi-default-doc-layout-toc-wrapper">
            <h4>ON THIS PAGE</h4>
            <Toc />
          </div>
        ) : null}
      </main>
    </div>
  );
}
