import { analyzeRepo, ingestRepo, toClientRepo } from "@/lib/agent";
import { sseResponse } from "@/lib/sse";
import { clearMessages } from "@/lib/db";
import { apiKeyFromRequest } from "@/lib/request-key";

export const runtime = "nodejs";
export const maxDuration = 800;

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { url?: string; force?: boolean };
  const apiKey = apiKeyFromRequest(request);

  return sseResponse(async (emit, signal) => {
    const repo = await ingestRepo(body.url ?? "", emit);
    emit({ type: "repo", repo: toClientRepo(repo) });

    if (repo.analysisMd && !body.force) {
      emit({ type: "done", content: repo.analysisMd, cached: true });
      return;
    }

    // A re-analysis invalidates a conversation grounded in the old brief.
    if (body.force) clearMessages(repo.id);

    const markdown = await analyzeRepo({ repo, onEvent: emit, signal, apiKey });
    emit({ type: "done", content: markdown });
  });
}
