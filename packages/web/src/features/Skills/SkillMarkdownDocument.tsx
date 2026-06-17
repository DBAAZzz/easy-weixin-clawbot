import type { ReactNode } from "react";
import { cn } from "../../lib/cn.js";
import type { MarkdownBlock } from "./types.js";
import { isMarkdownBlockBoundary, stripMarkdownFrontmatter } from "./types.js";

export function parseMarkdownBlocks(markdown: string): MarkdownBlock[] {
  const normalized = stripMarkdownFrontmatter(markdown).replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];

  const lines = normalized.split("\n");
  const blocks: MarkdownBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const currentLine = lines[index]!;
    const trimmed = currentLine.trim();

    if (!trimmed) {
      index += 1;
      continue;
    }

    const codeMatch = /^```([a-zA-Z0-9_-]+)?$/.exec(trimmed);
    if (codeMatch) {
      index += 1;
      const codeLines: string[] = [];
      while (index < lines.length && !/^```$/.test(lines[index]!.trim())) {
        codeLines.push(lines[index]!);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push({
        type: "code",
        language: codeMatch[1] ?? null,
        code: codeLines.join("\n").trimEnd(),
      });
      continue;
    }

    const headingMatch = /^(#{1,3})\s+(.*)$/.exec(trimmed);
    if (headingMatch) {
      blocks.push({
        type: "heading",
        level: headingMatch[1].length as 1 | 2 | 3,
        text: headingMatch[2].trim(),
      });
      index += 1;
      continue;
    }

    const orderedList = /^\d+\.\s+/.test(trimmed);
    const unorderedList = /^[-*]\s+/.test(trimmed);
    if (orderedList || unorderedList) {
      const items: string[] = [];
      while (index < lines.length) {
        const listLine = lines[index]!.trim();
        if (!listLine) break;
        if (orderedList && /^\d+\.\s+/.test(listLine)) {
          items.push(listLine.replace(/^\d+\.\s+/u, ""));
          index += 1;
          continue;
        }
        if (unorderedList && /^[-*]\s+/.test(listLine)) {
          items.push(listLine.replace(/^[-*]\s+/u, ""));
          index += 1;
          continue;
        }
        break;
      }
      blocks.push({ type: "list", ordered: orderedList, items });
      continue;
    }

    if (trimmed.startsWith(">")) {
      const quoteLines: string[] = [];
      while (index < lines.length && lines[index]!.trim().startsWith(">")) {
        quoteLines.push(lines[index]!.trim().replace(/^>\s?/u, ""));
        index += 1;
      }
      blocks.push({ type: "blockquote", text: quoteLines.join(" ") });
      continue;
    }

    const paragraphLines = [trimmed];
    index += 1;
    while (index < lines.length && !isMarkdownBlockBoundary(lines[index]!)) {
      paragraphLines.push(lines[index]!.trim());
      index += 1;
    }
    blocks.push({ type: "paragraph", text: paragraphLines.join(" ") });
  }

  return blocks;
}

function renderInlineMarkdown(text: string, keyPrefix: string): ReactNode[] {
  const tokens = text
    .split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\)|\*[^*]+\*)/u)
    .filter(Boolean);

  return tokens.map((token, index) => {
    const key = `${keyPrefix}-${index}`;

    if (token.startsWith("**") && token.endsWith("**")) {
      return (
        <strong key={key} className="font-semibold text-ink">
          {token.slice(2, -2)}
        </strong>
      );
    }

    if (token.startsWith("*") && token.endsWith("*")) {
      return (
        <em key={key} className="italic text-ink-soft">
          {token.slice(1, -1)}
        </em>
      );
    }

    if (token.startsWith("`") && token.endsWith("`")) {
      return (
        <code
          key={key}
          className="rounded-xs bg-accent-mist px-1.5 py-0.5 font-mono text-sm text-accent-strong"
        >
          {token.slice(1, -1)}
        </code>
      );
    }

    const linkMatch = /^\[([^\]]+)\]\(([^)]+)\)$/u.exec(token);
    if (linkMatch) {
      return (
        <a
          key={key}
          href={linkMatch[2]}
          target="_blank"
          rel="noreferrer"
          className="underline decoration-line underline-offset-4 transition hover:text-accent-strong"
        >
          {linkMatch[1]}
        </a>
      );
    }

    return <span key={key}>{token}</span>;
  });
}

export function SkillMarkdownDocument(props: { markdown: string }) {
  const blocks = parseMarkdownBlocks(props.markdown);

  if (blocks.length === 0) {
    return <p className="text-base leading-7 text-muted">暂无文档正文</p>;
  }

  return (
    <article className="space-y-4">
      {blocks.map((block, index) => {
        if (block.type === "heading") {
          if (block.level === 1) {
            return (
              <h4
                key={`heading-${index}`}
                className="text-4xl font-semibold tracking-title text-ink"
              >
                {renderInlineMarkdown(block.text, `heading-${index}`)}
              </h4>
            );
          }

          if (block.level === 2) {
            return (
              <h5
                key={`heading-${index}`}
                className="pt-2 text-2xl font-semibold tracking-title text-ink"
              >
                {renderInlineMarkdown(block.text, `heading-${index}`)}
              </h5>
            );
          }

          return (
            <h6
              key={`heading-${index}`}
              className="pt-1 text-xl font-semibold tracking-title text-ink-soft"
            >
              {renderInlineMarkdown(block.text, `heading-${index}`)}
            </h6>
          );
        }

        if (block.type === "paragraph") {
          return (
            <p key={`paragraph-${index}`} className="text-lg leading-7 text-ink-soft">
              {renderInlineMarkdown(block.text, `paragraph-${index}`)}
            </p>
          );
        }

        if (block.type === "blockquote") {
          return (
            <blockquote
              key={`blockquote-${index}`}
              className="border-l-2 border-accent pl-4 text-base leading-7 text-muted-strong"
            >
              {renderInlineMarkdown(block.text, `blockquote-${index}`)}
            </blockquote>
          );
        }

        if (block.type === "list") {
          const ListTag = block.ordered ? "ol" : "ul";
          return (
            <ListTag
              key={`list-${index}`}
              className={cn(
                "space-y-2 pl-5 text-base leading-7 text-ink-soft marker:text-accent-strong",
                block.ordered ? "list-decimal" : "list-disc",
              )}
            >
              {block.items.map((item, itemIndex) => (
                <li key={`list-${index}-${itemIndex}`}>
                  {renderInlineMarkdown(item, `list-${index}-${itemIndex}`)}
                </li>
              ))}
            </ListTag>
          );
        }

        return (
          <div
            key={`code-${index}`}
            className="overflow-hidden rounded-section border border-line bg-detail-bg"
          >
            {block.language ? (
              <div className="border-b border-line px-4 py-2 text-sm uppercase tracking-label text-muted">
                {block.language}
              </div>
            ) : null}
            <pre className="overflow-x-auto px-4 py-4 text-sm leading-6 text-ink-soft">
              <code>{block.code}</code>
            </pre>
          </div>
        );
      })}
    </article>
  );
}
