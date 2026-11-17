import { readFile, stat } from "node:fs/promises";
import { getRepo } from "@/lib/db";
import { safeResolve } from "@/lib/repo-cache";
import { RepoChatError } from "@/lib/types";

export const runtime = "nodejs";

const MAX_VIEWER_BYTES = 1024 * 1024;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const id = params.get("id");
  const filePath = params.get("path");
  if (!id || !filePath) {
    return Response.json({ error: "Missing id or path." }, { status: 400 });
  }

  const repo = getRepo(id);
  if (!repo) return Response.json({ error: "Repository not found." }, { status: 404 });

  try {
    const abs = safeResolve(repo.extractPath, filePath);
    const info = await stat(abs);
    if (!info.isFile()) {
      return Response.json({ error: "Not a file." }, { status: 400 });
    }
    if (info.size > MAX_VIEWER_BYTES) {
      return Response.json({ error: "File is too large to display." }, { status: 413 });
    }
    return Response.json({
      path: filePath,
      bytes: info.size,
      content: await readFile(abs, "utf8"),
      url: `${repo.htmlUrl}/blob/${repo.ref}/${filePath}`,
    });
  } catch (err) {
    if (err instanceof RepoChatError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    return Response.json({ error: `Could not read "${filePath}".` }, { status: 404 });
  }
}
