import { toClientRepo } from "@/lib/agent";
import { clearMessages, getMessages, getRepo } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return Response.json({ error: "Missing id." }, { status: 400 });

  const repo = getRepo(id);
  if (!repo) return Response.json({ error: "Repository not found." }, { status: 404 });

  return Response.json({ repo: toClientRepo(repo), messages: getMessages(id) });
}

export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return Response.json({ error: "Missing id." }, { status: 400 });
  clearMessages(id);
  return Response.json({ ok: true });
}
