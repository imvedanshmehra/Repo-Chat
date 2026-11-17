import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { RepoChatError, type LanguageSlice, type Manifest, type ManifestEntry } from "./types";

const SKIP_DIRS = new Set([
  ".git", "node_modules", "dist", "build", "out", ".next", ".nuxt", ".svelte-kit",
  "target", "vendor", "__pycache__", ".venv", "venv", "env", "coverage", ".mypy_cache",
  ".pytest_cache", ".gradle", ".idea", ".vscode", "bower_components", "Pods", ".terraform",
  "site-packages", ".tox", ".cache", "tmp", ".turbo", ".parcel-cache", "deps", "_build",
]);

const BINARY_EXT = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".bmp", ".ico", ".icns", ".svg",
  ".woff", ".woff2", ".ttf", ".otf", ".eot", ".mp3", ".mp4", ".mov", ".avi", ".webm",
  ".wav", ".flac", ".ogg", ".zip", ".gz", ".tgz", ".bz2", ".xz", ".7z", ".rar", ".jar",
  ".war", ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".so", ".dylib",
  ".dll", ".exe", ".bin", ".dat", ".db", ".sqlite", ".pyc", ".pyo", ".class", ".o", ".a",
  ".wasm", ".node", ".pack", ".idx", ".ds_store", ".map", ".min.js", ".min.css",
]);

const LOCKFILES = new Set([
  "package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lock", "bun.lockb",
  "poetry.lock", "Pipfile.lock", "Cargo.lock", "composer.lock", "Gemfile.lock",
  "go.sum", "uv.lock", "pdm.lock", "flake.lock", "mix.lock",
]);

/** Readable-file ceiling. Bigger files are listed in the manifest but not served to the model. */
const MAX_READABLE_BYTES = 512 * 1024;

const LANGUAGES: Record<string, string> = {
  ".ts": "TypeScript", ".tsx": "TypeScript", ".mts": "TypeScript", ".cts": "TypeScript",
  ".js": "JavaScript", ".jsx": "JavaScript", ".mjs": "JavaScript", ".cjs": "JavaScript",
  ".py": "Python", ".pyi": "Python", ".rb": "Ruby", ".go": "Go", ".rs": "Rust",
  ".java": "Java", ".kt": "Kotlin", ".kts": "Kotlin", ".scala": "Scala", ".swift": "Swift",
  ".c": "C", ".h": "C/C++ header", ".cc": "C++", ".cpp": "C++", ".cxx": "C++", ".hpp": "C++",
  ".cs": "C#", ".php": "PHP", ".ex": "Elixir", ".exs": "Elixir", ".erl": "Erlang",
  ".hs": "Haskell", ".clj": "Clojure", ".lua": "Lua", ".dart": "Dart", ".r": "R",
  ".pl": "Perl", ".sh": "Shell", ".bash": "Shell", ".zsh": "Shell", ".fish": "Shell",
  ".ps1": "PowerShell", ".sql": "SQL", ".graphql": "GraphQL", ".gql": "GraphQL",
  ".proto": "Protobuf", ".css": "CSS", ".scss": "Sass", ".sass": "Sass", ".less": "Less",
  ".html": "HTML", ".vue": "Vue", ".svelte": "Svelte", ".astro": "Astro",
  ".md": "Markdown", ".mdx": "Markdown", ".rst": "reStructuredText",
  ".json": "JSON", ".yaml": "YAML", ".yml": "YAML", ".toml": "TOML", ".xml": "XML",
  ".tf": "Terraform", ".nix": "Nix", ".zig": "Zig", ".m": "Objective-C", ".mm": "Objective-C++",
};

/** Languages excluded from the "what is this written in" breakdown. */
const NOT_A_LANGUAGE = new Set([
  "Markdown", "JSON", "YAML", "TOML", "XML", "reStructuredText", "CSS", "HTML",
]);

function isBinaryPath(rel: string): boolean {
  const lower = rel.toLowerCase();
  if (BINARY_EXT.has(path.extname(lower))) return true;
  return lower.endsWith(".min.js") || lower.endsWith(".min.css") || lower.endsWith(".map");
}

function countLines(buf: Buffer): number {
  let n = 0;
  for (const byte of buf) if (byte === 10) n++;
  return buf.length && buf[buf.length - 1] !== 10 ? n + 1 : n;
}

/** Walks the extracted repo and records every text file worth showing the model. */
export async function buildManifest(root: string): Promise<Manifest> {
  const entries: ManifestEntry[] = [];
  let skippedFiles = 0;
  let totalBytes = 0;

  async function walk(dir: string, rel: string, depth: number): Promise<void> {
    if (depth > 14) return;
    let dirents;
    try {
      dirents = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const dirent of dirents) {
      const relPath = rel ? `${rel}/${dirent.name}` : dirent.name;
      if (dirent.isSymbolicLink()) continue;
      if (dirent.isDirectory()) {
        if (SKIP_DIRS.has(dirent.name)) {
          skippedFiles++;
          continue;
        }
        await walk(path.join(dir, dirent.name), relPath, depth + 1);
        continue;
      }
      if (!dirent.isFile()) continue;

      if (isBinaryPath(relPath)) {
        skippedFiles++;
        continue;
      }

      let size: number;
      try {
        size = (await stat(path.join(dir, dirent.name))).size;
      } catch {
        continue;
      }

      const isLock = LOCKFILES.has(dirent.name);
      const readable = !isLock && size <= MAX_READABLE_BYTES && size > 0;

      let lines = 0;
      if (readable) {
        try {
          const buf = await readFile(path.join(dir, dirent.name));
          // A NUL byte in the first 8KB means it is binary despite the extension.
          if (buf.subarray(0, 8192).includes(0)) {
            skippedFiles++;
            continue;
          }
          lines = countLines(buf);
        } catch {
          continue;
        }
      }

      entries.push({ path: relPath, bytes: size, lines, readable });
      totalBytes += size;
    }
  }

  await walk(root, "", 0);
  entries.sort((a, b) => a.path.localeCompare(b.path));
  return { entries, totalFiles: entries.length, skippedFiles, totalBytes };
}

export function languageBreakdown(manifest: Manifest): LanguageSlice[] {
  const byLang = new Map<string, { bytes: number; files: number }>();
  for (const entry of manifest.entries) {
    const lang = LANGUAGES[path.extname(entry.path).toLowerCase()];
    if (!lang || NOT_A_LANGUAGE.has(lang)) continue;
    const cur = byLang.get(lang) ?? { bytes: 0, files: 0 };
    cur.bytes += entry.bytes;
    cur.files += 1;
    byLang.set(lang, cur);
  }
  const total = [...byLang.values()].reduce((sum, v) => sum + v.bytes, 0) || 1;
  return [...byLang.entries()]
    .map(([language, v]) => ({ language, ...v, share: v.bytes / total }))
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 12);
}

/**
 * Resolves a model- or client-supplied path inside the repo root.
 * Throws if the result escapes the root (path traversal) — every filesystem
 * read in this app goes through here.
 */
export function safeResolve(root: string, relPath: string): string {
  const cleaned = (relPath ?? "").replace(/^[./\\]+/, "").replace(/\\/g, "/");
  const resolved = path.resolve(root, cleaned);
  const rootWithSep = path.resolve(root) + path.sep;
  if (resolved !== path.resolve(root) && !resolved.startsWith(rootWithSep)) {
    throw new RepoChatError(`Path "${relPath}" is outside the repository.`, 403);
  }
  return resolved;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

/**
 * Renders the manifest as a compact indented tree for the system prompt.
 * Caps directories that explode so a monorepo cannot blow out the prefix.
 */
export function renderManifestTree(manifest: Manifest, maxFiles = 1800): string {
  const shown = manifest.entries.slice(0, maxFiles);
  const byDir = new Map<string, ManifestEntry[]>();
  for (const entry of shown) {
    const dir = path.dirname(entry.path);
    const key = dir === "." ? "" : dir;
    const list = byDir.get(key) ?? [];
    list.push(entry);
    byDir.set(key, list);
  }

  const lines: string[] = [];
  for (const dir of [...byDir.keys()].sort()) {
    const files = byDir.get(dir)!;
    lines.push(dir === "" ? "/" : `${dir}/`);
    const capped = files.slice(0, 60);
    for (const f of capped) {
      const flag = f.readable ? "" : " [not readable]";
      lines.push(`  ${path.basename(f.path)} (${f.lines}L, ${formatBytes(f.bytes)})${flag}`);
    }
    if (files.length > capped.length) {
      lines.push(`  ... ${files.length - capped.length} more files in this directory`);
    }
  }
  if (manifest.entries.length > shown.length) {
    lines.push(
      `... ${manifest.entries.length - shown.length} more files not listed — use list_files to see them.`,
    );
  }
  return lines.join("\n");
}
