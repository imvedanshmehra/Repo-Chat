"use client";

import { useEffect, useRef, useState } from "react";
import Markdown from "./Markdown";
import ToolChip from "./ToolChip";
import { keyHeaders } from "@/lib/key-store";
import { streamAgent } from "@/lib/stream-client";
import type { ChatMessage, ClientRepo, ToolEvent } from "@/lib/types";

const STARTERS = [
  "What happens when this starts up?",
  "Walk me through the main request path.",
  "Where is configuration loaded?",
  "How is this tested?",
];

export default function Chat({
  repo,
  initialMessages,
  knownPaths,
  apiKey,
  onOpenFile,
  onNeedKey,
}: {
  repo: ClientRepo;
  initialMessages: ChatMessage[];
  knownPaths: Set<string>;
  /** Bring-your-own key; empty when the server's env key is in use. */
  apiKey: string;
  onOpenFile: (path: string, line?: number) => void;
  onNeedKey?: () => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [streamText, setStreamText] = useState("");
  const [tools, setTools] = useState<ToolEvent[]>([]);
  const [error, setError] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const pinnedRef = useRef(true);

  useEffect(() => {
    setMessages(initialMessages);
    setStreamText("");
    setTools([]);
    setError(null);
  }, [initialMessages, repo.id]);

  // Follow the stream unless the reader has scrolled up.
  useEffect(() => {
    if (pinnedRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, streamText, tools]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  async function send(question: string) {
    const trimmed = question.trim();
    if (!trimmed || busy) return;

    setInput("");
    setError(null);
    setBusy(true);
    setStreamText("");
    setTools([]);
    pinnedRef.current = true;
    setMessages((prev) => [
      ...prev,
      { id: -Date.now(), role: "user", content: trimmed, toolLog: [], createdAt: new Date().toISOString() },
    ]);

    const controller = new AbortController();
    abortRef.current = controller;

    let answer = "";
    const collected: ToolEvent[] = [];

    try {
      await streamAgent(
        "/api/chat",
        { repoId: repo.id, message: trimmed },
        (event) => {
          switch (event.type) {
            case "tool":
              collected.push({ tool: event.tool, detail: event.detail });
              setTools([...collected]);
              break;
            case "text":
              answer += event.text;
              setStreamText(answer);
              break;
            case "done":
              answer = event.content;
              break;
            case "error":
              setError(event.message);
              if (event.message.includes("Anthropic API key")) onNeedKey?.();
              break;
          }
        },
        { signal: controller.signal, headers: keyHeaders(apiKey) },
      );
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setError(err instanceof Error ? err.message : "Something went wrong.");
      }
    }

    if (answer.trim()) {
      setMessages((prev) => [
        ...prev,
        {
          id: -Date.now() - 1,
          role: "assistant",
          content: answer,
          toolLog: collected,
          createdAt: new Date().toISOString(),
        },
      ]);
    } else {
      // No answer — drop the optimistic user bubble so it isn't orphaned.
      setMessages((prev) => prev.slice(0, -1));
      setInput(trimmed);
    }

    setStreamText("");
    setTools([]);
    setBusy(false);
    abortRef.current = null;
  }

  const empty = messages.length === 0 && !busy;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-5 sm:px-5"
      >
        {empty && (
          <div className="fade-up pt-2">
            <p className="text-sm text-mute-300">
              Ask anything about <span className="text-paper">{repo.name}</span>. Answers cite real
              files — click a citation to open it.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {STARTERS.map((q) => (
                <button
                  key={q}
                  onClick={() => void send(q)}
                  className="rounded-full border border-ink-700 bg-ink-850 px-3 py-1.5 text-xs text-mute-200 transition hover:border-accent-dim hover:text-paper"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((message) =>
          message.role === "user" ? (
            <div key={message.id} className="fade-up flex justify-end">
              <div className="max-w-[88%] rounded-2xl rounded-br-md border border-ink-700 bg-ink-800 px-3.5 py-2.5 text-sm whitespace-pre-wrap text-paper">
                {message.content}
              </div>
            </div>
          ) : (
            <div key={message.id} className="fade-up">
              {message.toolLog.length > 0 && (
                <details className="group mb-2">
                  <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 text-[11px] text-mute-400 transition hover:text-mute-300">
                    <svg viewBox="0 0 12 12" className="size-2.5 transition-transform group-open:rotate-90" aria-hidden>
                      <path d="M4 2l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    read {message.toolLog.length} source{message.toolLog.length === 1 ? "" : "s"}
                  </summary>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {message.toolLog.map((t, i) => (
                      <ToolChip key={i} tool={t.tool} detail={t.detail} />
                    ))}
                  </div>
                </details>
              )}
              <Markdown content={message.content} knownPaths={knownPaths} onOpenFile={onOpenFile} />
            </div>
          ),
        )}

        {busy && (
          <div className="fade-up space-y-2">
            {tools.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {tools.slice(-6).map((t, i) => (
                  <ToolChip key={i} tool={t.tool} detail={t.detail} />
                ))}
              </div>
            )}
            {streamText ? (
              <Markdown
                content={streamText}
                knownPaths={knownPaths}
                onOpenFile={onOpenFile}
                renderDiagrams={false}
              />
            ) : (
              <p className="flex items-center gap-1.5 text-xs text-mute-400">
                <span className="dot-pulse">●</span> reading the code…
              </p>
            )}
          </div>
        )}

        {error && (
          <p className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-xs text-bad">{error}</p>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
        className="shrink-0 border-t border-ink-700 bg-ink-900/60 p-3"
      >
        <div className="flex items-end gap-2 rounded-xl border border-ink-700 bg-ink-900 px-3 py-2 transition focus-within:border-accent-dim">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send(input);
              }
            }}
            rows={1}
            placeholder={busy ? "Waiting for the current answer…" : `Ask about ${repo.name}…`}
            className="max-h-40 min-h-6 flex-1 resize-none bg-transparent text-sm text-paper outline-none placeholder:text-mute-400"
            style={{ height: "auto" }}
            onInput={(e) => {
              const el = e.currentTarget;
              el.style.height = "auto";
              el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
            }}
          />
          {busy ? (
            <button
              type="button"
              onClick={() => abortRef.current?.abort()}
              className="shrink-0 rounded-lg border border-ink-600 px-2.5 py-1 text-xs text-mute-300 transition hover:border-bad/50 hover:text-bad"
            >
              Stop
            </button>
          ) : (
            <button
              type="submit"
              disabled={!input.trim()}
              className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-ink-950 transition enabled:hover:bg-[#9ad2ff] disabled:cursor-not-allowed disabled:opacity-35"
            >
              Ask
            </button>
          )}
        </div>
        <p className="mt-1.5 px-1 text-[11px] text-mute-400">
          Enter to send · Shift+Enter for a new line
        </p>
      </form>
    </div>
  );
}
