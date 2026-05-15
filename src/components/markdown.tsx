"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import Link from "next/link";
import { cn } from "@/lib/utils";

type ResolverMap = Record<string, string>;

const WIKILINK_RE = /\[\[([^\]\n|#]+)(?:#([^\]\n|]*))?(?:\|([^\]\n]*))?\]\]/g;

function rewriteWikilinks(md: string, resolver: ResolverMap): string {
  return md.replace(WIKILINK_RE, (_full, target, _anchor, alias) => {
    const t = String(target).trim();
    const label = alias ? String(alias).trim() : t;
    const id = resolver[t.toLowerCase()];
    if (id) return `[${label}](/?doc=${id})`;
    return `<span data-broken-link="${escapeAttr(t)}" class="rounded bg-amber-500/10 px-1 text-amber-500">${escapeHtml(label)}</span>`;
  });
}

function escapeAttr(s: string) {
  return s.replace(/"/g, "&quot;");
}
function escapeHtml(s: string) {
  return s.replace(
    /[&<>]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!,
  );
}

export function Markdown({
  source,
  wikilinks = {},
}: {
  source: string;
  wikilinks?: ResolverMap;
}) {
  const rewritten = rewriteWikilinks(source, wikilinks);

  return (
    <div className="text-sm leading-relaxed text-muted-foreground">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ className, ...props }) => (
            <h1
              className={cn(
                "mt-8 mb-4 text-2xl font-semibold tracking-tight text-foreground first:mt-0",
                className,
              )}
              {...props}
            />
          ),
          h2: ({ className, ...props }) => (
            <h2
              className={cn(
                "mt-8 mb-4 text-lg font-semibold text-foreground first:mt-0",
                className,
              )}
              {...props}
            />
          ),
          h3: ({ className, ...props }) => (
            <h3
              className={cn(
                "mt-6 mb-3 text-base font-semibold text-foreground first:mt-0",
                className,
              )}
              {...props}
            />
          ),
          h4: ({ className, ...props }) => (
            <h4
              className={cn(
                "mt-4 mb-2 text-sm font-semibold text-foreground first:mt-0",
                className,
              )}
              {...props}
            />
          ),
          p: ({ className, ...props }) => (
            <p
              className={cn("my-4 leading-relaxed", className)}
              {...props}
            />
          ),
          ul: ({ className, ...props }) => (
            <ul
              className={cn(
                "my-4 ml-6 list-disc space-y-2 marker:text-muted-foreground/60",
                className,
              )}
              {...props}
            />
          ),
          ol: ({ className, ...props }) => (
            <ol
              className={cn(
                "my-4 ml-6 list-decimal space-y-2 marker:text-muted-foreground/60",
                className,
              )}
              {...props}
            />
          ),
          li: ({ className, ...props }) => (
            <li className={cn("leading-relaxed", className)} {...props} />
          ),
          strong: ({ className, ...props }) => (
            <strong
              className={cn("font-semibold text-foreground", className)}
              {...props}
            />
          ),
          em: ({ className, ...props }) => (
            <em className={cn("italic", className)} {...props} />
          ),
          hr: ({ className, ...props }) => (
            <hr
              className={cn("my-8 border-border", className)}
              {...props}
            />
          ),
          blockquote: ({ className, ...props }) => (
            <blockquote
              className={cn(
                "my-6 border-l-2 border-primary/50 bg-primary/5 py-2 pl-4 rounded-r-md text-foreground [&>p]:my-0",
                className,
              )}
              {...props}
            />
          ),
          code: ({ className, children, ...rest }) => {
            // ReactMarkdown sets className="language-foo" on fenced code blocks
            // but inline code has no className.
            const isInline = !className?.startsWith("language-");
            if (isInline) {
              return (
                <code
                  className="rounded bg-secondary/70 px-1.5 py-0.5 font-mono text-[0.85em] text-primary"
                  {...rest}
                >
                  {children}
                </code>
              );
            }
            return (
              <code
                className={cn("font-mono text-xs", className)}
                {...rest}
              >
                {children}
              </code>
            );
          },
          pre: ({ className, children, ...props }) => {
            // Try to surface the language label from the inner <code class="language-…">.
            let lang: string | null = null;
            const child = Array.isArray(children) ? children[0] : children;
            if (
              child &&
              typeof child === "object" &&
              "props" in child &&
              typeof (child as { props?: { className?: string } }).props
                ?.className === "string"
            ) {
              const cls = (child as { props: { className: string } }).props
                .className;
              const m = cls.match(/language-([\w-]+)/);
              if (m) lang = m[1];
            }
            return (
              <div className="my-6 overflow-hidden rounded-md border border-border bg-secondary/50">
                {lang && (
                  <div className="border-b border-border bg-secondary/30 px-4 py-2 text-xs font-mono text-muted-foreground">
                    {lang}
                  </div>
                )}
                <pre
                  className={cn(
                    "overflow-x-auto p-4 text-xs font-mono leading-relaxed text-foreground",
                    className,
                  )}
                  {...props}
                >
                  {children}
                </pre>
              </div>
            );
          },
          a({ href, children, className, ...rest }) {
            if (href?.startsWith("/")) {
              return (
                <Link
                  href={href}
                  className={cn(
                    "text-primary underline-offset-4 hover:underline",
                    className,
                  )}
                  {...(rest as object)}
                >
                  {children}
                </Link>
              );
            }
            return (
              <a
                href={href}
                target="_blank"
                rel="noreferrer"
                className={cn(
                  "text-primary underline-offset-4 hover:underline",
                  className,
                )}
                {...rest}
              >
                {children}
              </a>
            );
          },
          table: ({ className, ...props }) => (
            <div className="my-6 overflow-x-auto rounded-md border border-border">
              <table
                className={cn("w-full text-sm", className)}
                {...props}
              />
            </div>
          ),
          thead: ({ className, ...props }) => (
            <thead
              className={cn("bg-secondary/30 text-foreground", className)}
              {...props}
            />
          ),
          th: ({ className, ...props }) => (
            <th
              className={cn(
                "px-3 py-2 text-left font-medium border-b border-border",
                className,
              )}
              {...props}
            />
          ),
          td: ({ className, ...props }) => (
            <td
              className={cn(
                "px-3 py-2 border-b border-border last:border-b-0",
                className,
              )}
              {...props}
            />
          ),
          img: ({ className, alt, ...props }) => (
            <img
              alt={alt ?? ""}
              className={cn(
                "my-4 max-w-full rounded-md border border-border",
                className,
              )}
              {...props}
            />
          ),
        }}
      >
        {rewritten}
      </ReactMarkdown>
    </div>
  );
}
