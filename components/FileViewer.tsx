"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import hljs from "highlight.js/lib/common";

const LANG_BY_EXT: Record<string, string> = {
  ts: "typescript", tsx: "typescript", mts: "typescript", cts: "typescript",
  js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
  py: "python", rb: "ruby", go: "go", rs: "rust", java: "java", kt: "kotlin",
  swift: "swift", c: "c", h: "c", cc: "cpp", cpp: "cpp", hpp: "cpp", cs: "csharp",
  php: "php", sh: "bash", bash: "bash", zsh: "bash", sql: "sql", css: "css",
  scss: "scss", less: "less", html: "xml", xml: "xml", vue: "xml", svelte: "xml",
  json: "json", yml: "yaml", yaml: "yaml", toml: "ini", ini: "ini", md: "markdown",
  dockerfile: "dockerfile", lua: "lua", dart: "dart", scala: "scala", ex: "elixir",
  exs: "elixir", graphql: "graphql", gql: "graphql",
};

type FileData = { path: string; content: string; bytes: number; url: string };

export default function FileViewer({
  repoId,
  path,
  line,
  onClose,
}: {
  repoId: string;
  path: string;
  line?: number;
  onClose: () => void;
}) {
  const [data, setData] = useState<FileData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lineRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);

    (async () => {
      try {
        const res = await fetch(
          `/api/file?id=${encodeURIComponent(repoId)}&path=${encodeURIComponent(path)}`,
        );
        const json = (await res.json()) as FileData & { error?: string };
        if (cancelled) return;
        if (!res.ok) setError(json.error ?? "Could not load that file.");
        else setData(json);
      } catch {
        if (!cancelled) setError("Could not load that file.");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [repoId, path]);

  useEffect(() => {
    if (data && line) {
      // Let the highlighted rows paint before scrolling to the cited line.
      requestAnimationFrame(() =>
        lineRef.current?.scrollIntoView({ block: "center", behavior: "smooth" }),
      );
    }
  }, [data, line]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const rows = useMemo(() => {
    if (!data) return [];
    const ext = path.split(".").pop()?.toLowerCase() ?? "";
    const language = LANG_BY_EXT[ext] ?? (path.toLowerCase().includes("dockerfile") ? "dockerfile" : null);
    let html: string;
    try {
      html = language
        ? hljs.highlight(data.content, { language, ignoreIllegals: true }).value
        : hljs.highlightAuto(data.content).value;
    } catch {
      html = data.content.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
    }
    // highlight.js emits spans that can straddle newlines; re-open them per line.
    return splitHighlightedLines(html);
  }, [data, path]);

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-end bg-ink-950/70 backdrop-blur-sm">
      <button className="flex-1 cursor-default" onClick={onClose} aria-label="Close file viewer" />
      <div className="flex h-full w-full max-w-4xl flex-col border-l border-ink-700 bg-ink-900 shadow-2xl">
        <header className="flex shrink-0 items-center gap-3 border-b border-ink-700 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="truncate font-mono text-sm text-paper">{path}</p>
            {data && (
              <p className="mt-0.5 text-xs text-mute-400">
                {rows.length} lines · {(data.bytes / 1024).toFixed(1)} KB
                {line ? ` · jumped to line ${line}` : ""}
              </p>
            )}
          </div>
          {data && (
            <a
              href={data.url}
              target="_blank"
              rel="noreferrer noopener"
              className="shrink-0 rounded-md border border-ink-600 px-2.5 py-1 text-xs text-mute-300 transition hover:border-ink-500 hover:text-paper"
            >
              GitHub ↗
            </a>
          )}
          <button
            onClick={onClose}
            className="shrink-0 rounded-md border border-ink-600 px-2.5 py-1 text-xs text-mute-300 transition hover:border-ink-500 hover:text-paper"
          >
            Close
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-auto">
          {error ? (
            <p className="p-6 text-sm text-bad">{error}</p>
          ) : !data ? (
            <p className="p-6 text-sm text-mute-400">Loading…</p>
          ) : (
            <pre className="min-w-max py-3 font-mono text-[12.5px] leading-[1.6]">
              <code>
                {rows.map((row, i) => {
                  const n = i + 1;
                  const isTarget = line === n;
                  return (
                    <div
                      key={n}
                      ref={isTarget ? lineRef : undefined}
                      className={`flex ${isTarget ? "bg-accent-dim/25" : ""}`}
                    >
                      <span className="sticky left-0 w-14 shrink-0 select-none bg-ink-900 pr-3 text-right text-mute-400/70">
                        {n}
                      </span>
                      <span
                        className="whitespace-pre pr-6 text-[#cdd9e5]"
                        dangerouslySetInnerHTML={{ __html: row || " " }}
                      />
                    </div>
                  );
                })}
              </code>
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Splits highlighted HTML into per-line fragments, re-opening any spans that were
 * left open at a newline so each line is valid standalone markup.
 */
function splitHighlightedLines(html: string): string[] {
  const lines = html.split("\n");
  const out: string[] = [];
  let openTags: string[] = [];

  for (const raw of lines) {
    const prefix = openTags.join("");
    let line = prefix + raw;

    const tagRe = /<(\/?)span([^>]*)>/g;
    let match: RegExpExecArray | null;
    const stack = [...openTags];
    while ((match = tagRe.exec(raw))) {
      if (match[1] === "/") stack.pop();
      else stack.push(`<span${match[2]}>`);
    }
    openTags = stack;
    line += "</span>".repeat(openTags.length);
    out.push(line);
  }
  return out;
}
