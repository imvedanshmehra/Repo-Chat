/** Pulls the first ```mermaid block out of a markdown document. */
export function extractMermaid(markdown: string): string | null {
  const match = markdown.match(/```mermaid\s*\n([\s\S]*?)```/);
  return match ? match[1].trim() : null;
}

/** Splits the brief into its `##` sections, preserving order. */
export function splitSections(markdown: string): Array<{ heading: string; body: string }> {
  const sections: Array<{ heading: string; body: string }> = [];
  const regex = /^## +(.+?)\s*$/gm;
  const matches = [...markdown.matchAll(regex)];
  matches.forEach((match, i) => {
    const start = match.index! + match[0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index! : markdown.length;
    sections.push({ heading: match[1], body: markdown.slice(start, end).trim() });
  });
  return sections;
}

const PATH_RE = /^[\w@.-]+(?:\/[\w@.+-]+)*\.[A-Za-z0-9]+(?::\d+(?:-\d+)?)?$/;

/**
 * Recognises `src/app.ts` and `src/app.ts:42` in inline code, but only when the
 * file really exists in the repo — so prose like `npm.json` never becomes a dead link.
 */
export function parseCitation(
  text: string,
  known: Set<string>,
): { path: string; line?: number } | null {
  const trimmed = text.trim();
  if (!PATH_RE.test(trimmed)) return null;
  const [rawPath, rawLine] = trimmed.split(":");
  const path = rawPath.replace(/^\.?\//, "");
  if (!known.has(path)) return null;
  const line = rawLine ? Number.parseInt(rawLine, 10) : undefined;
  return { path, line: Number.isFinite(line) ? line : undefined };
}

/**
 * Rebuilds the URL that resolves back to this exact repo id. Without the ref,
 * re-analysing a pinned tag or branch would silently fall back to the default
 * branch and create a second entry.
 */
export function pinnedUrl(repo: {
  htmlUrl: string;
  ref: string;
  defaultBranch: string;
}): string {
  return repo.ref === repo.defaultBranch ? repo.htmlUrl : `${repo.htmlUrl}/tree/${repo.ref}`;
}
