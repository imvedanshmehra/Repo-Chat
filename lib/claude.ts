import Anthropic from "@anthropic-ai/sdk";
import type { BetaRunnableTool } from "@anthropic-ai/sdk/lib/tools/BetaRunnableTool";
import { RepoChatError, type AgentEvent } from "./types";

export const MODEL = "claude-opus-5";
export const EFFORT = "high" as const;
export const MAX_TOKENS = 64_000;
/** Ceiling on agent turns per request; a deep repo tour uses ~10-20. */
export const MAX_ITERATIONS = 30;

/** True when the server has its own key, so the UI need not ask for one. */
export function hasServerKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

let envClient: Anthropic | null = null;

/**
 * A client for one request. A caller-supplied key (bring-your-own, arriving as a
 * request header) wins over the server's env var and is never cached, stored or
 * logged — it lives only for the duration of the request.
 */
export function anthropic(apiKey?: string): Anthropic {
  const byoKey = apiKey?.trim();
  if (byoKey) return new Anthropic({ apiKey: byoKey });

  if (!process.env.ANTHROPIC_API_KEY) {
    throw new RepoChatError(
      "No Anthropic API key. Add one under Settings, or set ANTHROPIC_API_KEY in .env.local.",
      401,
    );
  }
  // Zero-arg constructor resolves ANTHROPIC_API_KEY from the environment.
  envClient ??= new Anthropic();
  return envClient;
}

/** Cheap auth + model-access check: no tokens are generated. */
export async function verifyKey(apiKey?: string): Promise<{ model: string }> {
  const model = await anthropic(apiKey).models.retrieve(MODEL);
  return { model: model.display_name ?? model.id };
}

export type SystemBlock = Anthropic.Beta.Messages.BetaTextBlockParam;

/**
 * Runs one agentic turn set and streams every interesting event out through
 * `onEvent`. Returns the assistant's final text.
 */
export async function runAgent(options: {
  system: SystemBlock[];
  messages: Anthropic.Beta.Messages.BetaMessageParam[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tools: BetaRunnableTool<any>[];
  onEvent: (event: AgentEvent) => void;
  signal?: AbortSignal;
  /** Bring-your-own key for this request; falls back to the server's env var. */
  apiKey?: string;
}): Promise<string> {
  const { system, messages, tools, onEvent, signal, apiKey } = options;

  const runner = anthropic(apiKey).beta.messages.toolRunner(
    {
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system,
      messages,
      tools,
      thinking: { type: "adaptive", display: "summarized" },
      output_config: { effort: EFFORT },
      stream: true,
      max_iterations: MAX_ITERATIONS,
      // Start tool calls while the reply is still streaming.
      runToolsEagerly: true,
    },
    signal ? { signal } : undefined,
  );

  let answer = "";

  try {
    for await (const stream of runner) {
      for await (const event of stream) {
        if (event.type !== "content_block_delta") continue;
        if (event.delta.type === "text_delta") {
          answer += event.delta.text;
          onEvent({ type: "text", text: event.delta.text });
        } else if (event.delta.type === "thinking_delta") {
          onEvent({ type: "thinking", text: event.delta.thinking });
        }
      }
    }

    const final = await runner.done();

    if (final.stop_reason === "refusal") {
      throw new RepoChatError(
        `Claude declined this request${final.stop_details && "category" in final.stop_details ? ` (${final.stop_details.category})` : ""}.`,
        422,
      );
    }
    if (final.stop_reason === "max_tokens" && !answer.trim()) {
      throw new RepoChatError("The response hit the output limit before producing anything.", 502);
    }

    const usage = final.usage;
    console.log(
      `[claude] in=${usage.input_tokens} out=${usage.output_tokens} ` +
        `cache_read=${usage.cache_read_input_tokens ?? 0} cache_write=${usage.cache_creation_input_tokens ?? 0} ` +
        `stop=${final.stop_reason}`,
    );

    // Tool calls with no closing prose means the loop ran out of iterations.
    if (!answer.trim()) {
      throw new RepoChatError(
        "Claude stopped after exploring without writing an answer. Try a narrower question.",
        502,
      );
    }

    return answer;
  } catch (err) {
    throw toFriendlyError(err);
  }
}

/** Maps SDK exceptions to messages worth showing in the UI, most specific first. */
export function toFriendlyError(err: unknown): Error {
  if (err instanceof RepoChatError) return err;
  if (err instanceof Anthropic.AuthenticationError) {
    return new RepoChatError(
      "That Anthropic API key was rejected. Check it under Settings.",
      401,
    );
  }
  if (err instanceof Anthropic.PermissionDeniedError) {
    return new RepoChatError(
      `That API key cannot access "${MODEL}". Check the key's permissions.`,
      403,
    );
  }
  if (err instanceof Anthropic.RateLimitError) {
    return new RepoChatError("Rate-limited by the Anthropic API. Wait a moment and retry.", 429);
  }
  if (err instanceof Anthropic.NotFoundError) {
    return new RepoChatError(`Model "${MODEL}" is not available to this API key.`, 404);
  }
  if (err instanceof Anthropic.RequestTimeoutError) {
    return new RepoChatError("The Anthropic API took too long to respond. Try again.", 504);
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return new RepoChatError("Could not reach the Anthropic API. Check your connection.", 503);
  }
  if (err instanceof Anthropic.APIUserAbortError) {
    return new RepoChatError("Request cancelled.", 499);
  }
  if (err instanceof Anthropic.APIError) {
    return new RepoChatError(`Anthropic API error ${err.status ?? "?"}: ${err.message}`, 502);
  }
  if (err instanceof Error) return err;
  return new Error(String(err));
}
