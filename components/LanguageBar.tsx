"use client";

import { useMemo } from "react";
import type { LanguageSlice } from "@/lib/types";

/**
 * Categorical slots 1-6 in fixed order (dark steps), validated against this
 * app's chart surface (#11141a): lightness band, chroma floor, CVD separation,
 * normal-vision floor and 3:1 contrast all pass. Never reorder or cycle these —
 * anything past slot 6 folds into "Other" in neutral gray.
 */
const SERIES = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300"];
const OTHER = "#4b5361";

const MAX_SLOTS = 6;

export default function LanguageBar({ languages }: { languages: LanguageSlice[] }) {
  const slices = useMemo(() => {
    const head = languages.slice(0, MAX_SLOTS).map((l, i) => ({
      label: l.language,
      share: l.share,
      files: l.files,
      color: SERIES[i],
    }));
    const tail = languages.slice(MAX_SLOTS);
    if (tail.length) {
      head.push({
        label: `Other (${tail.length})`,
        share: tail.reduce((sum, l) => sum + l.share, 0),
        files: tail.reduce((sum, l) => sum + l.files, 0),
        color: OTHER,
      });
    }
    return head.filter((s) => s.share > 0);
  }, [languages]);

  if (!slices.length) return null;

  return (
    <div>
      {/* 2px surface gaps separate the segments, so identity never rests on hue alone. */}
      <div className="flex h-1.5 w-full gap-[2px] overflow-hidden rounded-full">
        {slices.map((slice) => (
          <div
            key={slice.label}
            title={`${slice.label} — ${(slice.share * 100).toFixed(1)}% of code bytes · ${slice.files} files`}
            style={{ width: `${Math.max(slice.share * 100, 1.5)}%`, background: slice.color }}
            className="h-full first:rounded-l-full last:rounded-r-full"
          />
        ))}
      </div>
      <ul className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1.5">
        {slices.map((slice) => (
          <li key={slice.label} className="flex items-center gap-1.5 text-[11px]">
            <span
              aria-hidden
              style={{ background: slice.color }}
              className="size-2 shrink-0 rounded-[2px]"
            />
            <span className="text-mute-200">{slice.label}</span>
            <span className="text-mute-400">{(slice.share * 100).toFixed(0)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
