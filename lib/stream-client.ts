import type { AgentEvent } from "./types";

/**
 * POSTs to an SSE endpoint and invokes `onEvent` for each event.
 * Resolves once the stream closes; rejects only on transport failure
 * (server-side problems arrive as an `error` event).
 */
export async function streamAgent(
  url: string,
  body: unknown,
  onEvent: (event: AgentEvent) => void,
  options: { signal?: AbortSignal; headers?: Record<string, string> } = {},
): Promise<void> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...options.headers },
    body: JSON.stringify(body),
    signal: options.signal,
  });

  if (!response.ok || !response.body) {
    onEvent({ type: "error", message: `Server returned ${response.status}.` });
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE frames are separated by a blank line.
    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const payload = frame
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (payload) {
        try {
          onEvent(JSON.parse(payload) as AgentEvent);
        } catch {
          /* ignore a frame we can't parse */
        }
      }
      boundary = buffer.indexOf("\n\n");
    }
  }
}
