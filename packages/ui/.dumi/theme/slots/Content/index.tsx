import { useLocation, useRouteMeta, useSiteData } from "dumi";
import DefaultContent from "dumi/theme-default/slots/Content";
import { useEffect, useRef, useState, type ReactNode } from "react";
import "../../style.css";

type ApiHeaderConfig = {
  pkg?: string;
};

const COMPONENT_IMPORTS: Record<string, string> = {
  Icons: "ActivityIcon",
  Sonner: "AppToaster, toast",
};

export default function Content(props: { children: ReactNode }) {
  const { frontmatter } = useRouteMeta();
  const { themeConfig } = useSiteData();
  const { pathname } = useLocation();
  const [copied, setCopied] = useState(false);
  const resetCopyTimer = useRef<number | undefined>(undefined);
  const apiHeaderConfig = themeConfig.apiHeader as ApiHeaderConfig | false | undefined;
  const isComponentPage = pathname.startsWith("/components/");
  const pageTitle = String(frontmatter.title ?? "");
  const componentName = String(frontmatter.atomId ?? COMPONENT_IMPORTS[pageTitle] ?? pageTitle);
  const packageName =
    typeof apiHeaderConfig === "object" ? (apiHeaderConfig.pkg ?? "@clawbot/ui") : "@clawbot/ui";
  const shouldShowApiHeader =
    apiHeaderConfig !== false &&
    frontmatter.apiHeader !== false &&
    (isComponentPage || Boolean(frontmatter.atomId));
  const importStatement = `import { ${componentName} } from '${packageName}';`;

  useEffect(
    () => () => {
      if (resetCopyTimer.current) {
        window.clearTimeout(resetCopyTimer.current);
      }
    },
    [],
  );

  async function copyImportStatement() {
    try {
      await navigator.clipboard.writeText(importStatement);
      setCopied(true);
      if (resetCopyTimer.current) {
        window.clearTimeout(resetCopyTimer.current);
      }
      resetCopyTimer.current = window.setTimeout(() => setCopied(false), 1600);
    } catch (error) {
      console.warn("Failed to copy component import statement.", error);
    }
  }

  return (
    <DefaultContent>
      {shouldShowApiHeader ? (
        <section
          className="clawbot-api-header"
          data-component-header={isComponentPage || undefined}
        >
          <h1 className="clawbot-api-header__title">{frontmatter.title}</h1>
          {frontmatter.description ? (
            <p className="clawbot-api-header__description">{frontmatter.description}</p>
          ) : null}
          <div className="clawbot-api-header__import">
            <code className="clawbot-api-header__snippet">{importStatement}</code>
            <button
              type="button"
              className="clawbot-api-header__copy"
              aria-label={copied ? "已复制导入语句" : "复制导入语句"}
              onClick={copyImportStatement}
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </section>
      ) : null}
      <div className={isComponentPage ? "clawbot-component-content" : undefined}>
        {props.children}
      </div>
    </DefaultContent>
  );
}
