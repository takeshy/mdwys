import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import type { MouseEvent } from "react";
import { MermaidCodeBlock } from "./MermaidCodeBlock";
import { isLocalDocumentHref } from "../lib/wikiLinks";

type MarkdownNode = {
  type?: string;
  value?: string;
  children?: MarkdownNode[];
  data?: {
    hProperties?: Record<string, string>;
  };
};

const calloutAliases: Record<string, string> = {
  summary: "abstract",
  tldr: "abstract",
  hint: "tip",
  important: "tip",
  check: "success",
  done: "success",
  help: "question",
  faq: "question",
  caution: "warning",
  attention: "warning",
  fail: "failure",
  missing: "failure",
  error: "danger",
  cite: "quote",
};

const supportedCallouts = new Set([
  "note",
  "abstract",
  "info",
  "todo",
  "tip",
  "success",
  "question",
  "warning",
  "failure",
  "danger",
  "bug",
  "example",
  "quote",
]);

const calloutIcons: Record<string, string> = {
  note: "i",
  abstract: "=",
  info: "i",
  todo: "✓",
  tip: "!",
  success: "✓",
  question: "?",
  warning: "!",
  failure: "x",
  danger: "!",
  bug: "*",
  example: "#",
  quote: '"',
};

function titleCase(value: string): string {
  return value
    .split("-")
    .filter(Boolean)
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(" ");
}

function parseCalloutMarker(value: string) {
  const match = value.match(/^\[!([A-Za-z0-9_-]+)\]([+-])?(?:[ \t]+([^\n]*))?(?:\n([\s\S]*))?$/);
  if (!match) return null;

  const rawType = match[1].toLowerCase();
  const normalizedType = calloutAliases[rawType] || rawType;
  const type = supportedCallouts.has(normalizedType) ? normalizedType : "note";

  return {
    type,
    title: match[3]?.trim() || titleCase(rawType),
    fold: match[2] === "+" ? "open" : match[2] === "-" ? "closed" : undefined,
    icon: calloutIcons[type] || calloutIcons.note,
    rest: match[4],
  };
}

function visitBlockquotes(node: MarkdownNode): void {
  if (node.type === "blockquote") {
    const first = node.children?.[0];
    const firstText = first?.type === "paragraph" ? first.children?.[0] : undefined;
    if (firstText?.type === "text" && typeof firstText.value === "string") {
      const callout = parseCalloutMarker(firstText.value);
      if (callout) {
        node.data = {
          ...node.data,
          hProperties: {
            ...node.data?.hProperties,
            "data-callout": callout.type,
            "data-callout-title": callout.title,
            "data-callout-icon": callout.icon,
            ...(callout.fold ? { "data-callout-fold": callout.fold } : {}),
          },
        };

        if (callout.rest) {
          firstText.value = callout.rest;
        } else if ((first?.children?.length || 0) <= 1) {
          node.children = node.children?.slice(1);
        } else {
          first?.children?.shift();
        }
      }
    }
  }

  node.children?.forEach(visitBlockquotes);
}

function remarkCallouts() {
  return (tree: MarkdownNode) => visitBlockquotes(tree);
}

function textFromChildren(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(textFromChildren).join("");
  if (value && typeof value === "object" && "props" in value) {
    return textFromChildren((value as { props?: { children?: unknown } }).props?.children);
  }
  return "";
}

function slugify(value: string): string {
  return value.trim().toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, "").replace(/\s+/g, "-");
}

export function MarkdownPreview({
  content,
  isDark,
  onLinkClick,
}: {
  content: string;
  isDark: boolean;
  onLinkClick?: (href: string, event: MouseEvent<HTMLElement>) => void;
}) {
  return (
    <div className="markdown-preview">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkCallouts]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          h1: ({ children }) => <h1 id={slugify(textFromChildren(children))}>{children}</h1>,
          h2: ({ children }) => <h2 id={slugify(textFromChildren(children))}>{children}</h2>,
          h3: ({ children }) => <h3 id={slugify(textFromChildren(children))}>{children}</h3>,
          h4: ({ children }) => <h4 id={slugify(textFromChildren(children))}>{children}</h4>,
          h5: ({ children }) => <h5 id={slugify(textFromChildren(children))}>{children}</h5>,
          h6: ({ children }) => <h6 id={slugify(textFromChildren(children))}>{children}</h6>,
          a: ({ href, children, ...props }) => {
            if (href && onLinkClick && isLocalDocumentHref(href)) {
              return (
                <button
                  type="button"
                  className="markdown-link-button"
                  onClick={(event) => {
                    onLinkClick?.(href, event);
                  }}
                >
                  {children}
                </button>
              );
            }
            return (
              <a
                href={href}
                target={href?.startsWith("#") ? undefined : "_blank"}
                rel="noreferrer"
                onClick={(event) => {
                  if (href) onLinkClick?.(href, event);
                }}
                {...props}
              >
                {children}
              </a>
            );
          },
          blockquote({ children, ...props }) {
            const calloutType = String((props as Record<string, unknown>)["data-callout"] || "");
            if (!calloutType) return <blockquote {...props}>{children}</blockquote>;

            const title = String((props as Record<string, unknown>)["data-callout-title"] || titleCase(calloutType));
            const icon = String((props as Record<string, unknown>)["data-callout-icon"] || calloutIcons.note);
            const isClosed = String((props as Record<string, unknown>)["data-callout-fold"] || "") === "closed";

            return (
              <blockquote {...props} className={`callout callout-${calloutType}`}>
                <div className="callout-title">
                  <span className="callout-icon">{icon}</span>
                  <span>{title}</span>
                </div>
                {!isClosed && <div className="callout-body">{children}</div>}
              </blockquote>
            );
          },
          code({ className, children, ...props }) {
            const isMermaid = /language-mermaid/.test(className || "");
            if (isMermaid) {
              return <MermaidCodeBlock code={String(children).replace(/\n$/, "")} isDark={isDark} />;
            }
            return (
              <code className={className} {...props}>
                {children}
              </code>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
