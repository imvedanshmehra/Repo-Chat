import { answerQuestion } from "@/lib/agent";
import { getRepo } from "@/lib/db";
import { sseResponse } from "@/lib/sse";
import { apiKeyFromRequest } from "@/lib/request-key";
import { RepoChatError } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 800;

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    repoId?: string;
    message?: string;
  };
  const apiKey = apiKeyFromRequest(request);

  return sseResponse(async (emit, signal) => {
    const question = (body.message ?? "").trim();
    if (!question) throw new RepoChatError("Ask a question first.");

    const repo = body.repoId ? getRepo(body.repoId) : null;
    if (!repo) throw new RepoChatError("That repository is not loaded. Analyse it again.", 404);

    const { answer } = await answerQuestion({ repo, question, onEvent: emit, signal, apiKey });
    emit({ type: "done", content: answer });
  });
}
