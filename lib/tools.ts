import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import * as z from "zod/v4";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { formatBytes, safeResolve } from "./repo-cache";
import { RepoChatError, type Manifest, type ToolEvent } from "./types";

/** Per-call output ceilings. Truncation is always stated in the result text. */
const MAX_LINES_PER_READ = 1500;
const MAX_CHARS_PER_READ = 80_000;
const MAX_CHARS_PER_RESULT = 120_000;
const MAX_FILES_PER_BATCH = 10;

function truncate(text: string, limit = MAX_CHARS_PER_RESULT): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n\n[truncated at ${limit} characters — narrow the request to see more]`;
}

/** Translates a shell-style glob into an anchored regex. Supports **, * and ?. */
function globToRegExp(glob: string): RegExp {
  let out = "";
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === "*") {
      if (glob[i + 1] === "*") {
        out += ".*";
        i++;
        if (glob[i + 1] === "/") i++;
      } else {
        out += "[^/]*";
      }
    } else if (ch === "?") {
      out += "[^/]";
    } else if ("\\^$.|+()[]{}".includes(ch)) {
      out += `\\${ch}`;
    } else {
      out += ch;
    }
  }
  return new RegExp(`^${out}$`, "i");
}

function withLineNumbers(text: string, startLine: number): string {
  const lines = text.split("\n");
  const width = String(startLine + lines.length - 1).length;
  return lines
    .map((line, i) => `${String(startLine + i).padStart(width, " ")}  ${line}`)
    .join("\n");
}

async function readRange(
  root: string,
  relPath: string,
  startLine?: number,
  endLine?: number,
): Promise<string> {
  const abs = safeResolve(root, relPath);
  let info;
  try {
    info = await stat(abs);
  } catch {
    return `Error: "${relPath}" does not exist. Use list_files or search_code to find the real path.`;
  }
  if (info.isDirectory()) {
    return `Error: "${relPath}" is a directory. Use list_files on it instead.`;
  }

  const raw = await readFile(abs, "utf8");
  const allLines = raw.split("\n");
  const from = Math.max(1, startLine ?? 1);
  const requestedTo = endLine ?? from + MAX_LINES_PER_READ - 1;
  const to = Math.min(allLines.length, requestedTo, from + MAX_LINES_PER_READ - 1);

  if (from > allLines.length) {
    return `Error: "${relPath}" has only ${allLines.length} lines; line ${from} is past the end.`;
  }

  let slice = allLines.slice(from - 1, to).join("\n");
  let charNote = "";
  if (slice.length > MAX_CHARS_PER_READ) {
    slice = slice.slice(0, MAX_CHARS_PER_READ);
    charNote = ` Output cut at ${MAX_CHARS_PER_READ} characters.`;
  }

  const header = `${relPath} — lines ${from}-${to} of ${allLines.length} (${formatBytes(info.size)})`;
  const footer =
    to < allLines.length
      ? `\n\n[${allLines.length - to} more lines. Call read_file with start_line: ${to + 1} to continue.]${charNote}`
      : charNote
        ? `\n\n[${charNote.trim()}]`
        : "";

  return `${header}\n\n${withLineNumbers(slice, from)}${footer}`;
}

/**
 * The repo tools. All four read from the extracted local cache — no network, no
 * GitHub rate limit — and resolve every path through safeResolve.
 *
 * `onEvent` surfaces each call to the UI as a tool-activity chip.
 */
export function createRepoTools(options: {
  root: string;
  manifest: Manifest;
  onEvent?: (event: ToolEvent) => void;
}) {
  const { root, manifest, onEvent } = options;
  const readablePaths = manifest.entries.filter((e) => e.readable);
  const emit = (tool: string, detail: string) => onEvent?.({ tool, detail });

  const listFiles = betaZodTool({
    name: "list_files",
    description:
      "List files and directories inside the repository. Use it to explore a directory you have not seen yet. Returns names with line counts and sizes.",
    inputSchema: z.object({
      path: z
        .string()
        .optional()
        .describe('Directory relative to the repo root, e.g. "src/lib". Omit for the root.'),
      depth: z
        .number()
        .int()
        .min(1)
        .max(4)
        .optional()
        .describe("How many directory levels to show. Default 2."),
    }),
    run: async ({ path: dirPath, depth }) => {
      const rel = (dirPath ?? "").replace(/^\/+|\/+$/g, "");
      emit("list_files", rel || "/");
      const maxDepth = depth ?? 2;
      const abs = safeResolve(root, rel);

      try {
        if (!(await stat(abs)).isDirectory()) {
          return `Error: "${rel}" is a file, not a directory. Use read_file.`;
        }
      } catch {
        return `Error: directory "${rel}" does not exist.`;
      }

      const sizeByPath = new Map(manifest.entries.map((e) => [e.path, e]));
      const lines: string[] = [];

      async function walk(dir: string, relDir: string, level: number): Promise<void> {
        if (level > maxDepth) return;
        const dirents = (await readdir(dir, { withFileTypes: true })).sort((a, b) => {
          if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
        for (const dirent of dirents) {
          if (dirent.name === ".git" || dirent.name === "node_modules") continue;
          const childRel = relDir ? `${relDir}/${dirent.name}` : dirent.name;
          const indent = "  ".repeat(level);
          if (dirent.isDirectory()) {
            lines.push(`${indent}${dirent.name}/`);
            await walk(path.join(dir, dirent.name), childRel, level + 1);
          } else if (dirent.isFile()) {
            const entry = sizeByPath.get(childRel);
            const note = entry
              ? ` (${entry.lines}L, ${formatBytes(entry.bytes)})${entry.readable ? "" : " [not readable]"}`
              : " [not indexed]";
            lines.push(`${indent}${dirent.name}${note}`);
          }
        }
      }

      await walk(abs, rel, 0);
      if (!lines.length) return `"${rel || "/"}" is empty.`;
      return truncate(`${rel || "/"} (depth ${maxDepth}):\n${lines.join("\n")}`);
    },
  });

  const readFileTool = betaZodTool({
    name: "read_file",
    description:
      "Read one file from the repository, with line numbers. Large files come back in pages — the result says how to request the next range.",
    inputSchema: z.object({
      path: z.string().describe('File path relative to the repo root, e.g. "src/index.ts".'),
      start_line: z.number().int().min(1).optional().describe("First line to read (1-indexed)."),
      end_line: z.number().int().min(1).optional().describe("Last line to read, inclusive."),
    }),
    run: async ({ path: filePath, start_line, end_line }) => {
      emit("read_file", filePath);
      try {
        return truncate(await readRange(root, filePath, start_line, end_line));
      } catch (err) {
        if (err instanceof RepoChatError) return `Error: ${err.message}`;
        return `Error reading "${filePath}": ${(err as Error).message}`;
      }
    },
  });

  const readManyFiles = betaZodTool({
    name: "read_many_files",
    description:
      "Read several whole files in one call. Prefer this over repeated read_file calls when you already know which files you need — it is much faster.",
    inputSchema: z.object({
      paths: z
        .array(z.string())
        .min(1)
        .max(MAX_FILES_PER_BATCH)
        .describe(`Up to ${MAX_FILES_PER_BATCH} file paths relative to the repo root.`),
    }),
    run: async ({ paths }) => {
      emit("read_many_files", `${paths.length} files: ${paths.slice(0, 3).join(", ")}${paths.length > 3 ? "…" : ""}`);
      const budget = Math.floor(MAX_CHARS_PER_RESULT / paths.length);
      const chunks = await Promise.all(
        paths.map(async (p) => {
          try {
            const body = await readRange(root, p);
            return `===== ${p} =====\n${body.length > budget ? `${body.slice(0, budget)}\n[truncated — read_file this path for the rest]` : body}`;
          } catch (err) {
            const message = err instanceof RepoChatError ? err.message : (err as Error).message;
            return `===== ${p} =====\nError: ${message}`;
          }
        }),
      );
      return truncate(chunks.join("\n\n"));
    },
  });

  const searchCode = betaZodTool({
    name: "search_code",
    description:
      "Search the repository with a regular expression and get back matching lines as path:line with surrounding context. Use it to locate a symbol, route, config key or import before reading files.",
    inputSchema: z.object({
      pattern: z.string().describe('JavaScript regular expression, e.g. "createServer|app\\\\.listen".'),
      glob: z
        .string()
        .optional()
        .describe('Restrict to matching paths, e.g. "**/*.ts" or "src/**". Omit to search everything.'),
      max_results: z.number().int().min(1).max(200).optional().describe("Default 40."),
      case_sensitive: z.boolean().optional().describe("Default false."),
    }),
    run: async ({ pattern, glob, max_results, case_sensitive }) => {
      emit("search_code", glob ? `/${pattern}/ in ${glob}` : `/${pattern}/`);
      let regex: RegExp;
      try {
        regex = new RegExp(pattern, case_sensitive ? "" : "i");
      } catch (err) {
        return `Error: "${pattern}" is not a valid regular expression (${(err as Error).message}).`;
      }

      const limit = max_results ?? 40;
      const globRe = glob ? globToRegExp(glob) : null;
      const candidates = globRe
        ? readablePaths.filter((e) => globRe.test(e.path))
        : readablePaths;

      if (!candidates.length) {
        return glob
          ? `No readable files match the glob "${glob}".`
          : "No readable files in this repository.";
      }

      const results: string[] = [];
      let matchCount = 0;
      let filesWithMatches = 0;

      for (const entry of candidates) {
        if (matchCount >= limit) break;
        let content: string;
        try {
          content = await readFile(safeResolve(root, entry.path), "utf8");
        } catch {
          continue;
        }
        if (!regex.test(content)) continue;

        const lines = content.split("\n");
        const hits: string[] = [];
        for (let i = 0; i < lines.length && matchCount < limit; i++) {
          if (!regex.test(lines[i])) continue;
          matchCount++;
          const before = i > 0 ? `  ${i}| ${lines[i - 1]}\n` : "";
          const after = i < lines.length - 1 ? `\n  ${i + 2}| ${lines[i + 1]}` : "";
          hits.push(`${before}> ${i + 1}| ${lines[i]}${after}`);
        }
        if (hits.length) {
          filesWithMatches++;
          results.push(`--- ${entry.path} ---\n${hits.join("\n\n")}`);
        }
      }

      if (!results.length) {
        return `No matches for /${pattern}/${glob ? ` in "${glob}"` : ""} across ${candidates.length} files.`;
      }

      const header = `${matchCount} match${matchCount === 1 ? "" : "es"} in ${filesWithMatches} file${filesWithMatches === 1 ? "" : "s"}${matchCount >= limit ? ` (stopped at the ${limit}-result limit)` : ""}:`;
      return truncate(`${header}\n\n${results.join("\n\n")}`);
    },
  });

  return [listFiles, searchCode, readFileTool, readManyFiles];
}
