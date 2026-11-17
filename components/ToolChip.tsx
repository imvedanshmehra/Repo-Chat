"use client";

const ICONS: Record<string, string> = {
  list_files: "◫",
  read_file: "▤",
  read_many_files: "▥",
  search_code: "⌕",
};

const LABELS: Record<string, string> = {
  list_files: "listed",
  read_file: "read",
  read_many_files: "read",
  search_code: "searched",
};

export default function ToolChip({ tool, detail }: { tool: string; detail: string }) {
  return (
    <span
      title={`${tool}: ${detail}`}
      className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-ink-700 bg-ink-850 px-2 py-[2px] text-[11px] text-mute-400"
    >
      <span aria-hidden className="text-mute-300">{ICONS[tool] ?? "·"}</span>
      <span className="shrink-0">{LABELS[tool] ?? tool}</span>
      <span className="truncate font-mono text-mute-300">{detail}</span>
    </span>
  );
}
