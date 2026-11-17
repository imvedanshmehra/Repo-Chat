"use client";

import { useState } from "react";
import type { RepoListItem } from "@/lib/types";

const EXAMPLES = [
  "https://github.com/vercel/ms",
  "https://github.com/honojs/hono",
  "https://github.com/tiangolo/fastapi",
];

export default function Landing({
  recent,
  busy,
  keyReady,
  usingOwnKey,
  onSubmit,
  onOpenRecent,
  onForget,
  onOpenSettings,
}: {
  recent: RepoListItem[];
  busy: boolean;
  keyReady: boolean;
  /** True when a key from this browser is in use rather than the server's env var. */
  usingOwnKey: boolean;
  onSubmit: (url: string) => void;
  onOpenRecent: (repo: RepoListItem) => void;
  onForget: (repo: RepoListItem) => void;
  onOpenSettings: () => void;
}) {
  const [url, setUrl] = useState("");

  return (
    <div className="mx-auto flex min-h-full w-full max-w-2xl flex-col justify-center px-5 py-16">
      <div className="fade-up">
        <div className="flex items-start justify-between gap-4">
          <h1 className="text-[1.75rem] font-semibold tracking-tight text-paper">Repo Chat</h1>
          <button
            onClick={onOpenSettings}
            className="mt-1.5 shrink-0 rounded-md border border-ink-700 px-2.5 py-1 text-xs text-mute-300 transition hover:border-ink-500 hover:text-paper"
          >
            API key
          </button>
        </div>
        <p className="mt-2 text-sm leading-relaxed text-mute-300">
          Paste any public GitHub repository. You get an architecture brief — what it does, the
          tech stack, how it is structured, and a flow diagram — then you can ask it anything.
        </p>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit(url);
          }}
          className="mt-7"
        >
          <div className="flex items-center gap-2 rounded-xl border border-ink-700 bg-ink-900 p-1.5 transition focus-within:border-accent-dim">
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="github.com/owner/repo"
              autoFocus
              spellCheck={false}
              className="min-w-0 flex-1 bg-transparent px-2.5 py-2 text-sm text-paper outline-none placeholder:text-mute-400"
            />
            <button
              type="submit"
              disabled={busy || !url.trim()}
              className="shrink-0 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-ink-950 transition enabled:hover:bg-[#9ad2ff] disabled:cursor-not-allowed disabled:opacity-35"
            >
              {busy ? "Working…" : "Analyse"}
            </button>
          </div>
        </form>

        {!keyReady ? (
          <button
            onClick={onOpenSettings}
            className="mt-3 flex w-full items-center gap-2 rounded-xl border border-warn/25 bg-warn/10 px-3.5 py-2.5 text-left text-xs text-warn transition hover:border-warn/40"
          >
            <span aria-hidden>→</span>
            Add your Anthropic API key to get started. It stays in this browser.
          </button>
        ) : (
          <p className="mt-3 flex items-center gap-1.5 text-[11px] text-mute-400">
            <span aria-hidden className="text-good">
              ●
            </span>
            {usingOwnKey ? "Using your API key from this browser" : "Using the server's API key"}
          </p>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-[11px] text-mute-400">Try</span>
          {EXAMPLES.map((example) => (
            <button
              key={example}
              onClick={() => setUrl(example)}
              className="rounded-full border border-ink-700 px-2.5 py-1 font-mono text-[11px] text-mute-300 transition hover:border-accent-dim hover:text-paper"
            >
              {example.replace("https://github.com/", "")}
            </button>
          ))}
        </div>

        {recent.length > 0 && (
          <div className="mt-12">
            <h2 className="text-xs font-medium tracking-wide text-mute-400 uppercase">
              Already analysed
            </h2>
            <ul className="mt-3 divide-y divide-ink-800 overflow-hidden rounded-xl border border-ink-800">
              {recent.map((repo) => (
                <li key={repo.id} className="group flex items-center gap-3 bg-ink-900/40">
                  <button
                    onClick={() => onOpenRecent(repo)}
                    className="min-w-0 flex-1 px-3.5 py-3 text-left transition hover:bg-ink-850"
                  >
                    <span className="block truncate text-sm text-paper">
                      {repo.owner}/{repo.name}
                      <span className="ml-1.5 font-mono text-[11px] text-mute-400">
                        @{repo.ref}
                      </span>
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-mute-400">
                      {repo.totalFiles} files
                      {repo.topLanguage ? ` · ${repo.topLanguage}` : ""}
                      {repo.analysed ? "" : " · not yet analysed"}
                    </span>
                  </button>
                  <button
                    onClick={() => onForget(repo)}
                    title="Forget this repository"
                    className="mr-2.5 shrink-0 rounded-md px-2 py-1 text-xs text-mute-400 opacity-0 transition group-hover:opacity-100 hover:text-bad"
                  >
                    Forget
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
