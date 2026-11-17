"use client";

import { API_KEY_HEADER } from "./request-key";

const STORAGE_KEY = "repo-chat.anthropic-key";

/**
 * The bring-your-own key lives in this browser only. It is sent on each request
 * as a header and is never written to the server's disk or database.
 */
export function readKey(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

export function writeKey(key: string): void {
  try {
    const trimmed = key.trim();
    if (trimmed) window.localStorage.setItem(STORAGE_KEY, trimmed);
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* private browsing with storage disabled — the key just won't persist */
  }
}

export function clearKey(): void {
  writeKey("");
}

/** `sk-ant-api03-…9fQ2` — enough to recognise, not enough to leak. */
export function maskKey(key: string): string {
  const trimmed = key.trim();
  if (trimmed.length <= 12) return "•".repeat(trimmed.length);
  return `${trimmed.slice(0, 11)}…${trimmed.slice(-4)}`;
}

/** Shape check only — real validation is a round trip to /api/key. */
export function looksLikeKey(key: string): boolean {
  return /^sk-ant-[A-Za-z0-9_-]{20,}$/.test(key.trim());
}

export function keyHeaders(key: string): Record<string, string> {
  const trimmed = key.trim();
  return trimmed ? { [API_KEY_HEADER]: trimmed } : {};
}
