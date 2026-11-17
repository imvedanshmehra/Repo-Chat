"use client";

import { useEffect, useId, useRef, useState } from "react";

let mermaidReady: Promise<typeof import("mermaid").default> | null = null;

function loadMermaid() {
  mermaidReady ??= import("mermaid").then(({ default: mermaid }) => {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: "base",
      fontFamily: 'ui-sans-serif, -apple-system, "Segoe UI", Inter, system-ui, sans-serif',
      themeVariables: {
        darkMode: true,
        background: "#0c0e12",
        primaryColor: "#161a21",
        primaryTextColor: "#e9edf3",
        primaryBorderColor: "#3a4250",
        secondaryColor: "#11141a",
        tertiaryColor: "#0c0e12",
        lineColor: "#6f7a8b",
        textColor: "#c3cad5",
        clusterBkg: "#0e1116",
        clusterBorder: "#2b313c",
        edgeLabelBackground: "#11141a",
        nodeBorder: "#3a4250",
        fontSize: "14px",
      },
      flowchart: { curve: "basis", padding: 14, useMaxWidth: true },
    });
    return mermaid;
  });
  return mermaidReady;
}

/**
 * Renders a mermaid source block. Bad syntax is the most likely visible failure
 * mode here, so a parse error falls back to the source plus a copy button
 * instead of an empty pane.
 */
export default function Diagram({
  code,
  onRegenerate,
  compact = false,
}: {
  code: string;
  onRegenerate?: () => void;
  compact?: boolean;
}) {
  const reactId = useId().replace(/[^a-zA-Z0-9]/g, "");
  const hostRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setError(null);

    (async () => {
      try {
        const mermaid = await loadMermaid();
        const { svg } = await mermaid.render(`d${reactId}`, code);
        if (cancelled) return;
        if (hostRef.current) hostRef.current.innerHTML = svg;
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        setError(message.split("\n").slice(0, 3).join(" ").slice(0, 220));
        // mermaid leaves an orphaned error node in the body on failure
        document.getElementById(`dd${reactId}`)?.remove();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [code, reactId]);

  if (error) {
    return (
      <div className="my-4 overflow-hidden rounded-xl border border-ink-700 bg-ink-900">
        <div className="flex items-center justify-between gap-3 border-b border-ink-700 bg-ink-850 px-3 py-2">
          <span className="text-xs text-warn">Diagram didn&apos;t parse — showing the source</span>
          <div className="flex shrink-0 items-center gap-2">
            <button
              onClick={() => {
                void navigator.clipboard.writeText(code);
                setCopied(true);
                setTimeout(() => setCopied(false), 1400);
              }}
              className="rounded-md border border-ink-600 px-2 py-1 text-[11px] text-mute-300 transition hover:border-ink-500 hover:text-paper"
            >
              {copied ? "Copied" : "Copy"}
            </button>
            {onRegenerate && (
              <button
                onClick={onRegenerate}
                className="rounded-md border border-ink-600 px-2 py-1 text-[11px] text-mute-300 transition hover:border-ink-500 hover:text-paper"
              >
                Regenerate
              </button>
            )}
          </div>
        </div>
        <pre className="overflow-x-auto p-3 text-xs leading-relaxed text-mute-300">
          <code>{code}</code>
        </pre>
        <p className="border-t border-ink-800 px-3 py-2 text-[11px] text-mute-400">{error}</p>
      </div>
    );
  }

  return (
    <div
      className={`mermaid-host overflow-x-auto rounded-xl border border-ink-700 bg-ink-900 ${
        compact ? "my-4 p-3" : "p-6"
      }`}
    >
      <div ref={hostRef} className="flex min-h-24 items-center justify-center" />
    </div>
  );
}
