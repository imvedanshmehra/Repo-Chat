import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { ChatMessage, LanguageSlice, Manifest, RepoMeta, StoredRepo, ToolEvent } from "./types";

let db: Database.Database | null = null;

function connect(): Database.Database {
  if (db) return db;
  const dir = path.join(process.cwd(), "data");
  mkdirSync(dir, { recursive: true });
  db = new Database(path.join(dir, "repo-chat.db"));
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS repos (
      id             TEXT PRIMARY KEY,
      owner          TEXT NOT NULL,
      name           TEXT NOT NULL,
      ref            TEXT NOT NULL,
      default_branch TEXT NOT NULL,
      html_url       TEXT NOT NULL,
      description    TEXT,
      stars          INTEGER NOT NULL DEFAULT 0,
      size_kb        INTEGER NOT NULL DEFAULT 0,
      extract_path   TEXT NOT NULL,
      manifest_json  TEXT NOT NULL,
      lang_json      TEXT NOT NULL,
      analysis_md    TEXT,
      created_at     TEXT NOT NULL,
      updated_at     TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS messages (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      repo_id       TEXT NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
      role          TEXT NOT NULL,
      content       TEXT NOT NULL,
      tool_log_json TEXT NOT NULL DEFAULT '[]',
      created_at    TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS messages_repo_idx ON messages(repo_id, id);
  `);
  return db;
}

type RepoRow = {
  id: string;
  owner: string;
  name: string;
  ref: string;
  default_branch: string;
  html_url: string;
  description: string | null;
  stars: number;
  size_kb: number;
  extract_path: string;
  manifest_json: string;
  lang_json: string;
  analysis_md: string | null;
  created_at: string;
  updated_at: string;
};

function rowToRepo(row: RepoRow): StoredRepo {
  return {
    id: row.id,
    owner: row.owner,
    name: row.name,
    ref: row.ref,
    defaultBranch: row.default_branch,
    htmlUrl: row.html_url,
    description: row.description,
    stars: row.stars,
    sizeKb: row.size_kb,
    extractPath: row.extract_path,
    manifest: JSON.parse(row.manifest_json) as Manifest,
    languages: JSON.parse(row.lang_json) as LanguageSlice[],
    analysisMd: row.analysis_md,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getRepo(id: string): StoredRepo | null {
  const row = connect().prepare("SELECT * FROM repos WHERE id = ?").get(id) as RepoRow | undefined;
  return row ? rowToRepo(row) : null;
}

export function listRepos(limit = 30): StoredRepo[] {
  const rows = connect()
    .prepare("SELECT * FROM repos ORDER BY updated_at DESC LIMIT ?")
    .all(limit) as RepoRow[];
  return rows.map(rowToRepo);
}

export function upsertRepo(input: {
  meta: RepoMeta;
  extractPath: string;
  manifest: Manifest;
  languages: LanguageSlice[];
}): StoredRepo {
  const now = new Date().toISOString();
  connect()
    .prepare(
      `INSERT INTO repos (id, owner, name, ref, default_branch, html_url, description, stars,
                          size_kb, extract_path, manifest_json, lang_json, analysis_md, created_at, updated_at)
       VALUES (@id, @owner, @name, @ref, @default_branch, @html_url, @description, @stars,
               @size_kb, @extract_path, @manifest_json, @lang_json, NULL, @now, @now)
       ON CONFLICT(id) DO UPDATE SET
         default_branch = excluded.default_branch,
         html_url       = excluded.html_url,
         description    = excluded.description,
         stars          = excluded.stars,
         size_kb        = excluded.size_kb,
         extract_path   = excluded.extract_path,
         manifest_json  = excluded.manifest_json,
         lang_json      = excluded.lang_json,
         updated_at     = excluded.updated_at`,
    )
    .run({
      id: input.meta.id,
      owner: input.meta.owner,
      name: input.meta.name,
      ref: input.meta.ref,
      default_branch: input.meta.defaultBranch,
      html_url: input.meta.htmlUrl,
      description: input.meta.description,
      stars: input.meta.stars,
      size_kb: input.meta.sizeKb,
      extract_path: input.extractPath,
      manifest_json: JSON.stringify(input.manifest),
      lang_json: JSON.stringify(input.languages),
      now,
    });
  return getRepo(input.meta.id)!;
}

export function saveAnalysis(repoId: string, markdown: string): void {
  connect()
    .prepare("UPDATE repos SET analysis_md = ?, updated_at = ? WHERE id = ?")
    .run(markdown, new Date().toISOString(), repoId);
}

export function touchRepo(repoId: string): void {
  connect()
    .prepare("UPDATE repos SET updated_at = ? WHERE id = ?")
    .run(new Date().toISOString(), repoId);
}

export function deleteRepo(repoId: string): void {
  const database = connect();
  database.prepare("DELETE FROM messages WHERE repo_id = ?").run(repoId);
  database.prepare("DELETE FROM repos WHERE id = ?").run(repoId);
}

export function getMessages(repoId: string): ChatMessage[] {
  const rows = connect()
    .prepare("SELECT * FROM messages WHERE repo_id = ? ORDER BY id ASC")
    .all(repoId) as Array<{
    id: number;
    role: string;
    content: string;
    tool_log_json: string;
    created_at: string;
  }>;
  return rows.map((row) => ({
    id: row.id,
    role: row.role === "user" ? "user" : "assistant",
    content: row.content,
    toolLog: JSON.parse(row.tool_log_json) as ToolEvent[],
    createdAt: row.created_at,
  }));
}

export function addMessage(input: {
  repoId: string;
  role: "user" | "assistant";
  content: string;
  toolLog?: ToolEvent[];
}): number {
  const result = connect()
    .prepare(
      `INSERT INTO messages (repo_id, role, content, tool_log_json, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(
      input.repoId,
      input.role,
      input.content,
      JSON.stringify(input.toolLog ?? []),
      new Date().toISOString(),
    );
  return Number(result.lastInsertRowid);
}

export function clearMessages(repoId: string): void {
  connect().prepare("DELETE FROM messages WHERE repo_id = ?").run(repoId);
}

export function deleteMessage(id: number): void {
  connect().prepare("DELETE FROM messages WHERE id = ?").run(id);
}
