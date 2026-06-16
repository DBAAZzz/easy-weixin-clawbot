import tailwindcss from "@tailwindcss/postcss";
import { defineConfig } from "dumi";
import type { INavItem } from "dumi/dist/client/theme-api/types";
import { join } from "node:path";

type WebpackChainConfig = {
  resolve: {
    set(key: string, value: unknown): void;
  };
};

const nav: INavItem[] = [
  { link: "/components/button", title: "Components" },
  { link: "/components/input", title: "Data Entry" },
  { link: "/components/dialog", title: "Feedback" },
];

const themeConfig = {
  apiHeader: {
    docUrl: false,
    match: ["/components"],
    pkg: "@clawbot/ui",
    sourceUrl: false,
  },
  description: "微信 ClawBot Agent 管理后台的 React 组件库。",
  docStyle: "block",
  lastUpdated: true,
  logo: false,
  name: "Clawbot UI",
  nav,
  prefersColor: {
    default: "light",
    switch: true,
  },
  siteToken: {
    contentMaxWidth: 980,
    headerHeight: 64,
    sidebarWidth: 240,
    tocWidth: 184,
  },
  title: "Clawbot UI",
};

export default defineConfig({
  alias: {
    "@clawbot/ui": join(process.cwd(), "src/index.ts"),
  },
  chainWebpack(config: WebpackChainConfig) {
    config.resolve.set("extensionAlias", {
      ".js": [".ts", ".tsx", ".js"],
      ".mjs": [".mts", ".mjs"],
    });
  },
  favicons: [],
  locales: [{ id: "zh-CN", name: "中文" }],
  outputPath: "docs-dist",
  resolve: {
    atomDirs: [{ dir: "src", type: "component" }],
  },
  themeConfig,
  title: "Clawbot UI",
  extraPostCSSPlugins: [tailwindcss()],
}) as unknown;
