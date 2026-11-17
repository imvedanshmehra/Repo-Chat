import { addMessage, deleteMessage, getMessages, getRepo, saveAnalysis, upsertRepo } from "./db";
import { downloadAndExtract, fetchRepoMeta, parseRepoUrl } from "./github";
import { buildManifest, languageBreakdown } from "./repo-cache";
import { ANALYSIS_OUTPUT_CONTRACT, chatInstructions, repoContextBlock } from "./prompts";
import { createRepoTools } from "./tools";
import { runAgent, type SystemBlock } from "./claude";
import {
  RepoChatError,
  type AgentEvent,
  type ClientRepo,
  type RepoListItem,
  type StoredRepo,
  type ToolEvent,
} from "./types";

/**
 * Resolves a pasted URL into a cached, indexed repo. One GitHub API call plus one
 * tarball download on a cold start; nothing on a warm one.
 */
export async function ingestRepo(
  url: string,
  onEvent: (event: AgentEvent) => void,
): Promise<StoredRepo> {
  const parsed = parseRepoUrl(url);

  onEvent({ type: "status", message: `Looking up ${parsed.owner}/${parsed.name}…` });
  const meta = await fetchRepoMeta(parsed);

  const existing = getRepo(meta.id);
  if (existing) {
    onEvent({ type: "status", message: "Loading from cache…" });
    // Re-extract if the cache directory was cleared out from under us.
    await downloadAndExtract(meta);
    return existing;
  }

  onEvent({ type: "status", message: `Downloading ${meta.owner}/${meta.name}@${meta.ref}…` });
  const extractPath = await downloadAndExtract(meta);

  onEvent({ type: "status", message: "Indexing files…" });
  const manifest = await buildManifest(extractPath);
  if (!manifest.totalFiles) {
    throw new RepoChatError("That repository has no readable text files.");
  }
  const languages = languageBreakdown(manifest);

  return upsertRepo({ meta, extractPath, manifest, languages });
}

function stableSystemBlock(repo: StoredRepo): SystemBlock {
  return {
    type: "text",
    text: repoContextBlock(repo),
    // Written by the analysis run, read by every chat turn.
    cache_control: { type: "ephemeral", ttl: "1h" },
  };
}

/** Produces the architecture brief and persists it. */
export async function analyzeRepo(options: {
  repo: StoredRepo;
  onEvent: (event: AgentEvent) => void;
  signal?: AbortSignal;
  apiKey?: string;
}): Promise<string> {
  const { repo, onEvent, signal, apiKey } = options;

  onEvent({ type: "status", message: "Reading the codebase…" });
  const tools = createRepoTools({
    root: repo.extractPath,
    manifest: repo.manifest,
    onEvent: (event) => onEvent({ type: "tool", ...event }),
  });

  const markdown = await runAgent({
    system: [
      stableSystemBlock(repo),
      { type: "text", text: ANALYSIS_OUTPUT_CONTRACT },
    ],
    messages: [
      {
        role: "user",
        content: `Analyse ${repo.owner}/${repo.name} and write the architecture brief.`,
      },
    ],
    tools,
    onEvent,
    signal,
    apiKey,
  });

  saveAnalysis(repo.id, markdown);
  return markdown;
}

/** Answers one chat question with the repo's full history in context. */
export async function answerQuestion(options: {
  repo: StoredRepo;
  question: string;
  onEvent: (event: AgentEvent) => void;
  signal?: AbortSignal;
  apiKey?: string;
}): Promise<{ answer: string; toolLog: ToolEvent[] }> {
  const { repo, question, onEvent, signal, apiKey } = options;

  const toolLog: ToolEvent[] = [];
  const tools = createRepoTools({
    root: repo.extractPath,
    manifest: repo.manifest,
    onEvent: (event) => {
      toolLog.push(event);
      onEvent({ type: "tool", ...event });
    },
  });

  const history = getMessages(repo.id).map((m) => ({
    role: m.role,
    content: m.content,
  }));

  const userMessageId = addMessage({ repoId: repo.id, role: "user", content: question });

  let answer: string;
  try {
    answer = await runAgent({
      system: [
        stableSystemBlock(repo),
        {
          type: "text",
          text: chatInstructions(repo.analysisMd, repo.ref),
          cache_control: { type: "ephemeral", ttl: "1h" },
        },
      ],
      messages: [...history, { role: "user", content: question }],
      tools,
      onEvent,
      signal,
      apiKey,
    });
  } catch (err) {
    // Don't leave a dangling user turn that would desync the next request.
    deleteMessage(userMessageId);
    throw err;
  }

  addMessage({ repoId: repo.id, role: "assistant", content: answer, toolLog });
  return { answer, toolLog };
}

/** Strips the local extraction path before sending a repo to the browser. */
export function toClientRepo(repo: StoredRepo): ClientRepo {
  const { extractPath: _extractPath, ...rest } = repo;
  return rest;
}

/** Summarises a repo for the landing-page list, leaving the manifest behind. */
export function toRepoListItem(repo: StoredRepo): RepoListItem {
  return {
    id: repo.id,
    owner: repo.owner,
    name: repo.name,
    ref: repo.ref,
    htmlUrl: repo.htmlUrl,
    description: repo.description,
    stars: repo.stars,
    totalFiles: repo.manifest.totalFiles,
    topLanguage: repo.languages[0]?.language ?? null,
    analysed: Boolean(repo.analysisMd),
    updatedAt: repo.updatedAt,
  };
}
