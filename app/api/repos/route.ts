import { toRepoListItem } from "@/lib/agent";
import { deleteRepo, listRepos } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  return Response.json({ repos: listRepos().map(toRepoListItem) });
}

export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return Response.json({ error: "Missing id." }, { status: 400 });
  deleteRepo(id);
  return Response.json({ ok: true });
}
