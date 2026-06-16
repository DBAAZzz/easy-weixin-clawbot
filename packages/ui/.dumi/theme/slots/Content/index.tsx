import { useRouteMeta, useSiteData } from "dumi";
import DefaultContent from "dumi/theme-default/slots/Content";
import type { ReactNode } from "react";
import "../../style.css";

type ApiHeaderConfig = {
  pkg?: string;
};

export default function Content(props: { children: ReactNode }) {
  const { frontmatter } = useRouteMeta();
  const { themeConfig } = useSiteData();
  const apiHeaderConfig = themeConfig.apiHeader as ApiHeaderConfig | false | undefined;
  const shouldShowApiHeader =
    apiHeaderConfig !== false && frontmatter.apiHeader !== false && Boolean(frontmatter.atomId);

  return (
    <DefaultContent>
      {shouldShowApiHeader ? (
        <section className="clawbot-api-header" id="api-header">
          <h1 className="clawbot-api-header__title">{frontmatter.title}</h1>
          {frontmatter.description ? (
            <p className="clawbot-api-header__description">{frontmatter.description}</p>
          ) : null}
          <code className="clawbot-api-header__snippet">
            import {"{ "}
            {frontmatter.atomId}
            {" }"} from &apos;{apiHeaderConfig?.pkg ?? "@clawbot/ui"}&apos;;
          </code>
        </section>
      ) : null}
      {props.children}
    </DefaultContent>
  );
}
