"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Chat from "@/components/Chat";
import Diagram from "@/components/Diagram";
import FileTree from "@/components/FileTree";
import FileViewer from "@/components/FileViewer";
import Landing from "@/components/Landing";
import LanguageBar from "@/components/LanguageBar";
import Markdown from "@/components/Markdown";
import Settings from "@/components/Settings";
import ToolChip from "@/components/ToolChip";
import { keyHeaders, readKey } from "@/lib/key-store";
import { extractMermaid, pinnedUrl } from "@/lib/markdown";
import { streamAgent } from "@/lib/stream-client";
import type { AgentEvent, ChatMessage, ClientRepo, RepoListItem, ToolEvent } from "@/lib/types";

type Tab = "analysis" | "diagram" | "files" | "chat";

export default function Page() {
  const [recent, setRecent] = useState<RepoListItem[]>([]);
  const [repo, setRepo] = useState<ClientRepo | null>(null);
  const [analysis, setAnalysis] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [working, setWorking] = useState(false);
  const [status, setStatus] = useState("");
  const [tools, setTools] = useState<ToolEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("analysis");
  const [viewer, setViewer] = useState<{ path: string; line?: number } | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [hasServerKey, setHasServerKey] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const abortRef = useRef<AbortController | null>(null);

  // A key in this browser, or the server's env var — either lets us call Claude.
  const keyReady = Boolean(apiKey) || hasServerKey;

  useEffect(() => {
    setApiKey(readKey());
    void (async () => {
      try {
        const res = await fetch("/api/key");
        const json = (await res.json()) as { hasServerKey: boolean };
        setHasServerKey(Boolean(json.hasServerKey));
      } catch {
        /* assume no server key; the UI will ask for one */
      }
    })();
  }, []);

  const loadRecent = useCallback(async () => {
    try {
      const res = await fetch("/api/repos");
      const json = (await res.json()) as { repos: RepoListItem[] };
      setRecent(json.repos ?? []);
    } catch {
      /* the landing page just shows no history */
    }
  }, []);

  useEffect(() => {
    void loadRecent();
  }, [loadRecent]);

  const analyze = useCallback(
    async (url: string, force = false) => {
      if (!url.trim()) return;
      if (!keyReady) {
        setSettingsOpen(true);
        return;
      }

      setWorking(true);
      setError(null);
      setTools([]);
      setAnalysis("");
      setStatus("Starting…");
      setTab("analysis");
      if (force) setMessages([]);

      const controller = new AbortController();
      abortRef.current = controller;
      let streamed = "";

      const onEvent = (event: AgentEvent) => {
        switch (event.type) {
          case "status":
            setStatus(event.message);
            break;
          case "repo":
            setRepo(event.repo);
            break;
          case "tool":
            setTools((prev) => [...prev, { tool: event.tool, detail: event.detail }]);
            break;
          case "text":
            streamed += event.text;
            setAnalysis(streamed);
            break;
          case "done":
            setAnalysis(event.content);
            setStatus("");
            break;
          case "error":
            setError(event.message);
            if (event.message.includes("Anthropic API key")) setSettingsOpen(true);
            break;
        }
      };

      try {
        await streamAgent("/api/analyze", { url, force }, onEvent, {
          signal: controller.signal,
          headers: keyHeaders(apiKey),
        });
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setError(err instanceof Error ? err.message : "Something went wrong.");
        }
      }

      setWorking(false);
      setStatus("");
      abortRef.current = null;
      void loadRecent();
    },
    [apiKey, keyReady, loadRecent],
  );

  const openRepo = useCallback(
    async (target: RepoListItem) => {
      setError(null);
      setTab("analysis");
      setTools([]);
      try {
        const res = await fetch(`/api/repo?id=${encodeURIComponent(target.id)}`);
        const json = (await res.json()) as {
          repo: ClientRepo;
          messages: ChatMessage[];
          error?: string;
        };
        if (!res.ok) {
          setError(json.error ?? "Could not open that repository.");
          return;
        }
        setRepo(json.repo);
        setMessages(json.messages);
        setAnalysis(json.repo.analysisMd ?? "");
        if (!json.repo.analysisMd) void analyze(pinnedUrl(json.repo));
      } catch {
        setError("Could not open that repository.");
      }
    },
    [analyze],
  );

  const forget = useCallback(
    async (target: RepoListItem) => {
      await fetch(`/api/repos?id=${encodeURIComponent(target.id)}`, { method: "DELETE" });
      if (repo?.id === target.id) setRepo(null);
      void loadRecent();
    },
    [loadRecent, repo?.id],
  );

  const clearChat = useCallback(async () => {
    if (!repo) return;
    await fetch(`/api/repo?id=${encodeURIComponent(repo.id)}`, { method: "DELETE" });
    setMessages([]);
  }, [repo]);

  const knownPaths = useMemo(
    () => new Set(repo?.manifest.entries.map((e) => e.path) ?? []),
    [repo],
  );

  const diagram = useMemo(() => extractMermaid(analysis), [analysis]);

  const openFile = useCallback((path: string, line?: number) => setViewer({ path, line }), []);

  // Landing: nothing loaded yet and nothing in flight.
  if (!repo && !working) {
    return (
      <main className="min-h-dvh">
        {error && (
          <div className="mx-auto max-w-2xl px-5 pt-6">
            <p className="rounded-lg border border-bad/30 bg-bad/10 px-3.5 py-2.5 text-sm text-bad">
              {error}
            </p>
          </div>
        )}
        <Landing
          recent={recent}
          busy={working}
          keyReady={keyReady}
          usingOwnKey={Boolean(apiKey)}
          onSubmit={(url) => void analyze(url)}
          onOpenRecent={(target) => void openRepo(target)}
          onForget={(target) => void forget(target)}
          onOpenSettings={() => setSettingsOpen(true)}
        />
        {settingsOpen && (
          <Settings
            hasServerKey={hasServerKey}
            onClose={() => setSettingsOpen(false)}
            onSaved={(key) => {
              setApiKey(key);
              setError(null);
              setSettingsOpen(false);
            }}
          />
        )}
      </main>
    );
  }

  const tabs: Array<{ id: Tab; label: string; hideOnDesktop?: boolean }> = [
    { id: "analysis", label: "Analysis" },
    { id: "diagram", label: "Diagram" },
    { id: "files", label: `Files${repo ? ` (${repo.manifest.totalFiles})` : ""}` },
    { id: "chat", label: "Chat", hideOnDesktop: true },
  ];

  return (
    <main className="flex h-dvh flex-col overflow-hidden">
      <header className="shrink-0 border-b border-ink-700 bg-ink-900/80 backdrop-blur">
        <div className="flex items-center gap-3 px-4 py-2.5">
          <button
            onClick={() => {
              abortRef.current?.abort();
              setRepo(null);
              setAnalysis("");
              setMessages([]);
              setError(null);
              void loadRecent();
            }}
            title="Back to all repositories"
            className="shrink-0 rounded-md border border-ink-700 px-2 py-1 text-xs text-mute-300 transition hover:border-ink-500 hover:text-paper"
          >
            ←
          </button>

          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <h1 className="truncate text-sm font-medium text-paper">
                {repo ? `${repo.owner}/${repo.name}` : "Loading…"}
              </h1>
              {repo && (
                <span className="shrink-0 font-mono text-[11px] text-mute-400">@{repo.ref}</span>
              )}
            </div>
            {repo?.description && (
              <p className="truncate text-xs text-mute-400">{repo.description}</p>
            )}
          </div>

          {repo && (
            <div className="hidden shrink-0 items-center gap-2 sm:flex">
              <span className="text-xs text-mute-400">★ {repo.stars.toLocaleString()}</span>
              <a
                href={repo.htmlUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="rounded-md border border-ink-700 px-2 py-1 text-xs text-mute-300 transition hover:border-ink-500 hover:text-paper"
              >
                GitHub ↗
              </a>
              {messages.length > 0 && (
                <button
                  onClick={() => void clearChat()}
                  className="rounded-md border border-ink-700 px-2 py-1 text-xs text-mute-300 transition hover:border-ink-500 hover:text-paper"
                >
                  Clear chat
                </button>
              )}
              <button
                onClick={() => setSettingsOpen(true)}
                title={apiKey ? "Using your API key" : "Using the server's API key"}
                className="rounded-md border border-ink-700 px-2 py-1 text-xs text-mute-300 transition hover:border-ink-500 hover:text-paper"
              >
                Key
              </button>
              <button
                onClick={() => void analyze(pinnedUrl(repo), true)}
                disabled={working}
                className="rounded-md border border-ink-700 px-2 py-1 text-xs text-mute-300 transition enabled:hover:border-ink-500 enabled:hover:text-paper disabled:opacity-40"
              >
                {working ? "Analysing…" : "Re-analyse"}
              </button>
            </div>
          )}
        </div>

        <nav className="flex gap-1 overflow-x-auto px-3 pb-0">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`shrink-0 border-b-2 px-2.5 pb-2 text-xs transition ${
                t.hideOnDesktop ? "lg:hidden" : ""
              } ${
                tab === t.id
                  ? "border-accent text-paper"
                  : "border-transparent text-mute-400 hover:text-mute-200"
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        {/* Left pane: brief, diagram, file tree */}
        <section
          className={`min-h-0 flex-col overflow-hidden border-ink-700 lg:flex lg:border-r ${
            tab === "chat" ? "hidden" : "flex"
          }`}
        >
          {tab === "files" && repo ? (
            <div className="min-h-0 flex-1 pt-3">
              <FileTree
                manifest={repo.manifest}
                onOpenFile={(path) => openFile(path)}
                activePath={viewer?.path}
              />
            </div>
          ) : tab === "diagram" ? (
            <div className="min-h-0 flex-1 overflow-auto p-4">
              {diagram ? (
                <Diagram code={diagram} onRegenerate={() => repo && void analyze(pinnedUrl(repo), true)} />
              ) : (
                <p className="text-sm text-mute-400">
                  {working
                    ? "The diagram appears once the brief is written."
                    : "This brief has no diagram. Re-analyse to try again."}
                </p>
              )}
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto">
              {repo && (
                <div className="border-b border-ink-800 px-5 py-4">
                  <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-mute-400">
                    <span>{repo.manifest.totalFiles} indexed files</span>
                    <span>
                      {(repo.manifest.totalBytes / 1024 / 1024).toFixed(2)} MB of text
                    </span>
                    <span>{repo.manifest.skippedFiles} skipped</span>
                  </div>
                  <LanguageBar languages={repo.languages} />
                </div>
              )}

              <div className="px-5 py-5">
                {working && (
                  <div className="mb-5 rounded-xl border border-ink-700 bg-ink-900/60 p-3.5">
                    <p className="flex items-center gap-2 text-xs text-mute-200">
                      <span className="dot-pulse text-accent">●</span>
                      {status || "Reading the codebase…"}
                    </p>
                    {tools.length > 0 && (
                      <div className="mt-2.5 flex flex-wrap gap-1.5">
                        {tools.slice(-10).map((t, i) => (
                          <ToolChip key={i} tool={t.tool} detail={t.detail} />
                        ))}
                      </div>
                    )}
                    <p className="mt-2.5 text-[11px] text-mute-400">
                      {tools.length} file operation{tools.length === 1 ? "" : "s"} so far
                    </p>
                  </div>
                )}

                {error && (
                  <p className="mb-5 rounded-lg border border-bad/30 bg-bad/10 px-3.5 py-2.5 text-sm text-bad">
                    {error}
                  </p>
                )}

                {analysis ? (
                  <Markdown
                    content={analysis}
                    knownPaths={knownPaths}
                    onOpenFile={openFile}
                    renderDiagrams={!working}
                  />
                ) : (
                  !working && !error && (
                    <p className="text-sm text-mute-400">
                      No brief yet. Hit Re-analyse to generate one.
                    </p>
                  )
                )}
              </div>
            </div>
          )}
        </section>

        {/* Right pane: chat */}
        <section
          className={`min-h-0 flex-col overflow-hidden lg:flex ${
            tab === "chat" ? "flex" : "hidden"
          }`}
        >
          {repo ? (
            <Chat
              repo={repo}
              initialMessages={messages}
              knownPaths={knownPaths}
              apiKey={apiKey}
              onOpenFile={openFile}
              onNeedKey={() => setSettingsOpen(true)}
            />
          ) : (
            <p className="p-5 text-sm text-mute-400">Chat opens once the repository is indexed.</p>
          )}
        </section>
      </div>

      {settingsOpen && (
        <Settings
          hasServerKey={hasServerKey}
          onClose={() => setSettingsOpen(false)}
          onSaved={(key) => {
            setApiKey(key);
            setError(null);
            setSettingsOpen(false);
          }}
        />
      )}

      {viewer && repo && (
        <FileViewer
          repoId={repo.id}
          path={viewer.path}
          line={viewer.line}
          onClose={() => setViewer(null)}
        />
      )}
    </main>
  );
}
