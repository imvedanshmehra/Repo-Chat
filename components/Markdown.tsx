"use client";

import { memo, useMemo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import Diagram from "./Diagram";
import { parseCitation } from "@/lib/markdown";

type Props = {
  content: string;
  /** Paths from the repo manifest — used to turn real file references into links. */
  knownPaths?: Set<string>;
  onOpenFile?: (path: string, line?: number) => void;
  /** Render mermaid blocks as diagrams. Off while text is still streaming in. */
  renderDiagrams?: boolean;
};

function MarkdownBody({ content, knownPaths, onOpenFile, renderDiagrams = true }: Props) {
  const components = useMemo<Components>(() => {
    return {
      // Tables need their own scroll container so the page never scrolls sideways.
      table: ({ children }) => (
        <div className="table-scroll">
          <table>{children}</table>
        </div>
      ),
      a: ({ href, children }) => (
        <a href={href} target="_blank" rel="noreferrer noopener">
          {children}
        </a>
      ),
      code: ({ className, children, ...rest }) => {
        const language = /language-(\w+)/.exec(className ?? "")?.[1];
        const text = String(children ?? "");

        if (language === "mermaid") {
          return renderDiagrams ? (
            <Diagram code={text.trim()} compact />
          ) : (
            <code className={className} {...rest}>
              {children}
            </code>
          );
        }

        // Inline code that names a real file becomes a click-to-open citation.
        if (!className && knownPaths && onOpenFile) {
          const citation = parseCitation(text, knownPaths);
          if (citation) {
            return (
              <button
                type="button"
                onClick={() => onOpenFile(citation.path, citation.line)}
                title={`Open ${citation.path}`}
                className="cursor-pointer rounded-[5px] border border-ink-600 bg-ink-800 px-[0.36em] py-[0.1em] font-mono text-[0.8125em] whitespace-nowrap text-accent transition hover:border-accent-dim hover:bg-ink-700"
              >
                {text}
              </button>
            );
          }
        }

        return (
          <code className={className} {...rest}>
            {children}
          </code>
        );
      },
    };
  }, [knownPaths, onOpenFile, renderDiagrams]);

  return (
    <div className="prose-repo">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

export default memo(MarkdownBody);
