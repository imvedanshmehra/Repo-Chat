export type RepoRef = {
  owner: string;
  name: string;
  /** Branch, tag or commit-ish. Resolved to the default branch when the URL omits it. */
  ref: string;
};

export type RepoMeta = RepoRef & {
  id: string; // `${owner}/${name}@${ref}`
  defaultBranch: string;
  htmlUrl: string;
  description: string | null;
  stars: number;
  /** Repo size as reported by the GitHub API, in kilobytes. */
  sizeKb: number;
};

export type ManifestEntry = {
  path: string;
  bytes: number;
  lines: number;
  /** Listed for structure but too large / binary / lockfile to feed to the model. */
  readable: boolean;
};

export type Manifest = {
  entries: ManifestEntry[];
  totalFiles: number;
  /** Files present in the tree but excluded from `entries` (vendored dirs, binaries). */
  skippedFiles: number;
  totalBytes: number;
};

export type LanguageSlice = { language: string; bytes: number; files: number; share: number };

export type StoredRepo = RepoMeta & {
  extractPath: string;
  manifest: Manifest;
  languages: LanguageSlice[];
  analysisMd: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ChatMessage = {
  id: number;
  role: "user" | "assistant";
  content: string;
  toolLog: ToolEvent[];
  createdAt: string;
};

export type ToolEvent = { tool: string; detail: string };

/** What the browser sees: everything but the local filesystem path. */
export type ClientRepo = Omit<StoredRepo, "extractPath">;

/** Events pushed over SSE by /api/analyze and /api/chat. */
export type AgentEvent =
  | { type: "status"; message: string }
  | { type: "repo"; repo: ClientRepo }
  | { type: "thinking"; text: string }
  | { type: "tool"; tool: string; detail: string }
  | { type: "text"; text: string }
  | { type: "done"; content: string; cached?: boolean }
  | { type: "error"; message: string };

export class RepoChatError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "RepoChatError";
  }
}

/** Lightweight row for the "already analysed" list — no manifest, no brief body. */
export type RepoListItem = {
  id: string;
  owner: string;
  name: string;
  ref: string;
  htmlUrl: string;
  description: string | null;
  stars: number;
  totalFiles: number;
  topLanguage: string | null;
  analysed: boolean;
  updatedAt: string;
};
