"use client";

import { useMemo, useState } from "react";
import type { Manifest, ManifestEntry } from "@/lib/types";

type Node = {
  name: string;
  path: string;
  children: Map<string, Node>;
  file?: ManifestEntry;
};

function buildTree(entries: ManifestEntry[]): Node {
  const root: Node = { name: "", path: "", children: new Map() };
  for (const entry of entries) {
    const parts = entry.path.split("/");
    let node = root;
    parts.forEach((part, i) => {
      const isLeaf = i === parts.length - 1;
      let child = node.children.get(part);
      if (!child) {
        child = {
          name: part,
          path: parts.slice(0, i + 1).join("/"),
          children: new Map(),
        };
        node.children.set(part, child);
      }
      if (isLeaf) child.file = entry;
      node = child;
    });
  }
  return root;
}

function sortChildren(node: Node): Node[] {
  return [...node.children.values()].sort((a, b) => {
    const aDir = !a.file;
    const bDir = !b.file;
    if (aDir !== bDir) return aDir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

function countFiles(node: Node): number {
  if (node.file) return 1;
  let total = 0;
  for (const child of node.children.values()) total += countFiles(child);
  return total;
}

function Row({
  node,
  depth,
  open,
  toggle,
  onOpenFile,
  activePath,
  filtering,
}: {
  node: Node;
  depth: number;
  open: Set<string>;
  toggle: (path: string) => void;
  onOpenFile: (path: string) => void;
  activePath?: string;
  filtering: boolean;
}) {
  const isDir = !node.file;
  const isOpen = filtering || open.has(node.path) || depth === 0;

  if (isDir) {
    const children = sortChildren(node);
    return (
      <>
        {depth > 0 && (
          <button
            onClick={() => toggle(node.path)}
            className="flex w-full items-center gap-1.5 rounded-md py-[3px] pr-2 text-left text-xs text-mute-200 transition hover:bg-ink-800"
            style={{ paddingLeft: `${depth * 11 + 6}px` }}
          >
            <svg
              viewBox="0 0 12 12"
              className={`size-2.5 shrink-0 text-mute-400 transition-transform ${isOpen ? "rotate-90" : ""}`}
              aria-hidden
            >
              <path d="M4 2l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="truncate font-medium">{node.name}</span>
            <span className="ml-auto shrink-0 text-[10px] text-mute-400">{countFiles(node)}</span>
          </button>
        )}
        {isOpen &&
          children.map((child) => (
            <Row
              key={child.path}
              node={child}
              depth={depth + 1}
              open={open}
              toggle={toggle}
              onOpenFile={onOpenFile}
              activePath={activePath}
              filtering={filtering}
            />
          ))}
      </>
    );
  }

  const active = activePath === node.path;
  return (
    <button
      onClick={() => onOpenFile(node.path)}
      disabled={!node.file?.readable}
      className={`flex w-full items-center gap-1.5 rounded-md py-[3px] pr-2 text-left text-xs transition ${
        active
          ? "bg-accent-dim/25 text-accent"
          : node.file?.readable
            ? "text-mute-300 hover:bg-ink-800 hover:text-paper"
            : "cursor-not-allowed text-mute-400/60"
      }`}
      style={{ paddingLeft: `${depth * 11 + 20}px` }}
      title={node.file?.readable ? node.path : `${node.path} (not indexed for reading)`}
    >
      <span className="truncate">{node.name}</span>
      {node.file?.readable ? (
        <span className="ml-auto shrink-0 text-[10px] text-mute-400">{node.file.lines}L</span>
      ) : null}
    </button>
  );
}

export default function FileTree({
  manifest,
  onOpenFile,
  activePath,
}: {
  manifest: Manifest;
  onOpenFile: (path: string) => void;
  activePath?: string;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());

  const entries = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return manifest.entries;
    return manifest.entries.filter((e) => e.path.toLowerCase().includes(q)).slice(0, 300);
  }, [manifest.entries, query]);

  const tree = useMemo(() => buildTree(entries), [entries]);

  const toggle = (path: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 px-3 pb-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter files…"
          className="w-full rounded-lg border border-ink-700 bg-ink-900 px-2.5 py-1.5 text-xs text-paper outline-none transition placeholder:text-mute-400 focus:border-accent-dim"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {entries.length === 0 ? (
          <p className="px-2 py-4 text-xs text-mute-400">No files match “{query}”.</p>
        ) : (
          <Row
            node={tree}
            depth={0}
            open={open}
            toggle={toggle}
            onOpenFile={onOpenFile}
            activePath={activePath}
            filtering={query.trim().length > 0}
          />
        )}
      </div>
    </div>
  );
}
