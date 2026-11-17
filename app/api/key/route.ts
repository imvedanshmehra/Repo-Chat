import { hasServerKey, toFriendlyError, verifyKey } from "@/lib/claude";
import { apiKeyFromRequest } from "@/lib/request-key";

export const runtime = "nodejs";

/** Whether the server already holds a key, so the UI knows not to ask. */
export async function GET() {
  return Response.json({ hasServerKey: hasServerKey() });
}

/**
 * Validates a bring-your-own key against the Models API — an auth and
 * model-access check that generates no tokens, so it costs nothing.
 * The key is read from the header, used once, and never stored.
 */
export async function POST(request: Request) {
  const apiKey = apiKeyFromRequest(request);
  if (!apiKey && !hasServerKey()) {
    return Response.json({ ok: false, error: "No key supplied." }, { status: 400 });
  }

  try {
    const { model } = await verifyKey(apiKey);
    return Response.json({ ok: true, model });
  } catch (err) {
    return Response.json({ ok: false, error: toFriendlyError(err).message });
  }
}
