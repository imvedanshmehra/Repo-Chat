"use client";

import { useEffect, useState } from "react";
import { clearKey, keyHeaders, looksLikeKey, maskKey, readKey, writeKey } from "@/lib/key-store";

type Check = { state: "idle" | "checking" | "ok" | "bad"; message?: string };

export default function Settings({
  hasServerKey,
  onClose,
  onSaved,
}: {
  hasServerKey: boolean;
  onClose: () => void;
  onSaved: (key: string) => void;
}) {
  const [stored, setStored] = useState("");
  const [draft, setDraft] = useState("");
  const [reveal, setReveal] = useState(false);
  const [check, setCheck] = useState<Check>({ state: "idle" });

  useEffect(() => {
    setStored(readKey());
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  async function verify(key: string) {
    setCheck({ state: "checking" });
    try {
      const res = await fetch("/api/key", { method: "POST", headers: keyHeaders(key) });
      const json = (await res.json()) as { ok: boolean; model?: string; error?: string };
      if (json.ok) {
        setCheck({ state: "ok", message: json.model });
        return true;
      }
      setCheck({ state: "bad", message: json.error ?? "That key was rejected." });
      return false;
    } catch {
      setCheck({ state: "bad", message: "Could not reach the server." });
      return false;
    }
  }

  async function save() {
    const key = draft.trim();
    if (!key) return;
    if (!(await verify(key))) return;
    writeKey(key);
    setStored(key);
    setDraft("");
    setReveal(false);
    onSaved(key);
  }

  function remove() {
    clearKey();
    setStored("");
    setCheck({ state: "idle" });
    onSaved("");
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink-950/75 p-4 backdrop-blur-sm sm:items-center">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        className="fade-up w-full max-w-lg rounded-2xl border border-ink-700 bg-ink-900 shadow-2xl"
      >
        <header className="flex items-center justify-between border-b border-ink-700 px-5 py-3.5">
          <h2 className="text-sm font-medium text-paper">Anthropic API key</h2>
          <button
            onClick={onClose}
            className="rounded-md border border-ink-700 px-2 py-1 text-xs text-mute-300 transition hover:border-ink-500 hover:text-paper"
          >
            Close
          </button>
        </header>

        <div className="space-y-4 px-5 py-4">
          <p className="text-xs leading-relaxed text-mute-300">
            Your key is kept in this browser only and sent with each request. It is never written
            to the server&apos;s disk or database, and never logged. Get one from{" "}
            <a
              href="https://console.anthropic.com/settings/keys"
              target="_blank"
              rel="noreferrer noopener"
              className="text-accent underline decoration-accent-dim underline-offset-2"
            >
              console.anthropic.com
            </a>
            .
          </p>

          {stored ? (
            <div className="rounded-xl border border-ink-700 bg-ink-850 p-3.5">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-mono text-xs text-paper">{maskKey(stored)}</p>
                  <p className="mt-1 text-[11px] text-mute-400">Saved in this browser</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    onClick={() => void verify(stored)}
                    disabled={check.state === "checking"}
                    className="rounded-md border border-ink-600 px-2 py-1 text-[11px] text-mute-300 transition enabled:hover:border-ink-500 enabled:hover:text-paper disabled:opacity-50"
                  >
                    {check.state === "checking" ? "Checking…" : "Test"}
                  </button>
                  <button
                    onClick={remove}
                    className="rounded-md border border-ink-600 px-2 py-1 text-[11px] text-mute-300 transition hover:border-bad/50 hover:text-bad"
                  >
                    Remove
                  </button>
                </div>
              </div>
            </div>
          ) : hasServerKey ? (
            <p className="rounded-xl border border-good/25 bg-good/10 px-3.5 py-2.5 text-xs text-good">
              Using the server&apos;s <code className="font-mono">ANTHROPIC_API_KEY</code>. Add a
              key below to use your own instead.
            </p>
          ) : (
            <p className="rounded-xl border border-warn/25 bg-warn/10 px-3.5 py-2.5 text-xs text-warn">
              No key yet — add one to analyse a repository.
            </p>
          )}

          <div>
            <div className="flex items-center gap-2 rounded-xl border border-ink-700 bg-ink-950 p-1.5 transition focus-within:border-accent-dim">
              <input
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value);
                  setCheck({ state: "idle" });
                }}
                onKeyDown={(e) => e.key === "Enter" && void save()}
                type={reveal ? "text" : "password"}
                placeholder="sk-ant-…"
                spellCheck={false}
                autoComplete="off"
                autoFocus
                className="min-w-0 flex-1 bg-transparent px-2.5 py-1.5 font-mono text-xs text-paper outline-none placeholder:text-mute-400"
              />
              <button
                onClick={() => setReveal((v) => !v)}
                className="shrink-0 rounded-lg px-2 py-1.5 text-[11px] text-mute-400 transition hover:text-mute-200"
              >
                {reveal ? "Hide" : "Show"}
              </button>
              <button
                onClick={() => void save()}
                disabled={!draft.trim() || check.state === "checking"}
                className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-ink-950 transition enabled:hover:bg-[#9ad2ff] disabled:cursor-not-allowed disabled:opacity-35"
              >
                {check.state === "checking" ? "Verifying…" : stored ? "Replace" : "Save"}
              </button>
            </div>

            {draft.trim() && !looksLikeKey(draft) && check.state === "idle" && (
              <p className="mt-2 text-[11px] text-warn">
                Anthropic keys normally start with <code className="font-mono">sk-ant-</code>. It
                will still be verified when you save.
              </p>
            )}
            {check.state === "ok" && (
              <p className="mt-2 text-[11px] text-good">
                Verified{check.message ? ` — ${check.message}` : ""}
              </p>
            )}
            {check.state === "bad" && <p className="mt-2 text-[11px] text-bad">{check.message}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
