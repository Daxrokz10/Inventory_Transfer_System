/* Shared client for the locally-hosted LLM (Qwen via LM Studio).

   The model runs on a PC at home, exposed to this app through a Cloudflare
   Tunnel — so unlike every other dependency here, it is EXPECTED to be
   unreachable a good part of the time (PC asleep, tunnel down, laptop
   travelling). That single fact drives the whole shape of this file:

     - chatComplete NEVER throws. It returns a discriminated result, so a
       callsite renders "assistant unavailable" instead of a 500. Anything
       that could reasonably go wrong — DNS, timeout, non-200, malformed
       body, missing env — comes back as { ok: false }.
     - A hard timeout, because a half-open tunnel would otherwise hang a
       server action until the platform kills it.

   Server-only: reads non-public env vars, so importing this from a client
   component would fail to resolve them. Every callsite is a server action
   or a route handler.

   No tool-calling, no streaming. The model is handed a pre-computed,
   read-only snapshot and asked for prose — it has no path to the database
   (see llmContext.ts for how the snapshot is built and fenced). */

/** True once the tunnel URL is configured. Used to hide the AI surfaces
    entirely on a deployment that has no model behind it, rather than
    showing buttons that can only ever fail. Mirrors isSupabaseConfigured. */
export const isLlmConfigured = Boolean(process.env.LLM_BASE_URL);

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export type ChatResult =
  | { ok: true; text: string }
  | { ok: false; error: string };

export interface ChatOptions {
  /** Sampling temperature. Defaults low — every use here is "restate these
      numbers faithfully", never creative writing. */
  temperature?: number;
  maxTokens?: number;
  /** Hard ceiling on the round trip. Kept under the platform's own function
      limit so we return a clean error instead of being killed mid-request. */
  timeoutMs?: number;
}

/* A 9B model on a home PC is not fast, and a reasoning model is slower still.
   Kept below the platform's own 60s function ceiling so we return a readable
   message rather than being killed mid-request. */
const DEFAULT_TIMEOUT_MS = 45_000;
const DEFAULT_MAX_TOKENS = 1_200;

/* Merge neighbouring system messages into one.

   Several chat templates — Qwen3.5's among them — allow exactly one system
   message, at position zero, and reject anything else with a Jinja error
   ("System message must be at the beginning") surfaced as an HTTP 400. That's
   a property of whichever GGUF is loaded, not of the OpenAI protocol, so it
   is normalised here rather than left for each callsite to remember. */
function collapseSystemMessages(messages: ChatMessage[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const m of messages) {
    const prev = out[out.length - 1];
    if (m.role === "system" && prev?.role === "system") {
      prev.content = `${prev.content}\n\n${m.content}`;
      continue;
    }
    // Copied, so merging never mutates the caller's array.
    out.push({ ...m });
  }
  return out;
}

/** Shown verbatim to admins, so it says what to do rather than what broke. */
const UNAVAILABLE =
  "The local assistant isn't reachable right now — the PC hosting it may be asleep or offline. Everything else on this page works as normal.";

export async function chatComplete(
  messages: ChatMessage[],
  opts: ChatOptions = {},
): Promise<ChatResult> {
  const base = process.env.LLM_BASE_URL;
  if (!base) {
    return { ok: false, error: "The local assistant isn't configured yet." };
  }

  const secret = process.env.LLM_TUNNEL_SECRET;
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );

  const url = `${base.replace(/\/$/, "")}/chat/completions`;
  const post = (noThinking: boolean) =>
    fetch(url, {
      method: "POST",
      signal: controller.signal,
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        ...(secret ? { "X-Llm-Secret": secret } : {}),
      },
      body: JSON.stringify({
        // LM Studio serves whichever model is loaded regardless of this
        // value, but the OpenAI schema requires the field.
        model: process.env.LLM_MODEL || "local-model",
        messages: collapseSystemMessages(messages),
        temperature: opts.temperature ?? 0.2,
        max_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
        stream: false,
        /* Reasoning models (Qwen3.x, DeepSeek-R1 and friends) otherwise spend
           the whole token budget "thinking" and return an empty `content`
           with the chain-of-thought in `reasoning_content`. None of the work
           here benefits from that — the numbers are already computed, the
           model only has to phrase them — so thinking is switched off at the
           chat template. Passed as a template kwarg, which servers that don't
           understand it ignore; the retry below covers the stricter ones. */
        ...(noThinking
          ? { chat_template_kwargs: { enable_thinking: false } }
          : {}),
      }),
    });

  try {
    let res = await post(true);
    // A strict server may reject the unknown template kwarg outright. One
    // retry without it, so an unrecognised knob degrades to "slower and
    // chattier" instead of "broken".
    if (res.status === 400) {
      console.warn("LLM rejected enable_thinking kwarg; retrying without it");
      res = await post(false);
    }

    if (!res.ok) {
      // A 5xx from the tunnel usually means nothing is listening behind it,
      // which reads to the admin the same as "offline".
      if (res.status >= 500) return { ok: false, error: UNAVAILABLE };
      return {
        ok: false,
        error: `The assistant rejected the request (HTTP ${res.status}).`,
      };
    }

    const body: unknown = await res.json();
    const extracted = extractText(body);
    if (extracted.text) return { ok: true, text: extracted.text };
    // Empty answer but a chain-of-thought present means the budget ran out
    // mid-thought. Saying so beats a generic "empty response", because the fix
    // is a real one the admin can act on.
    if (extracted.wasThinking) {
      return {
        ok: false,
        error:
          "The model used its whole response budget thinking and never got to an answer. Try a shorter question, or turn off reasoning for this model in LM Studio.",
      };
    }
    return { ok: false, error: "The assistant returned an empty response." };
  } catch (err) {
    // AbortError (our timeout) and TypeError (DNS/connection refused) both
    // land here, and both mean the same thing to the person looking at the
    // screen. Logged so a genuinely odd failure is still diagnosable.
    if (!(err instanceof Error && err.name === "AbortError")) {
      console.error("LLM request failed", err);
    }
    return { ok: false, error: UNAVAILABLE };
  } finally {
    clearTimeout(timer);
  }
}

/** Pull the assistant text out of an OpenAI-shaped response without trusting
    its shape — a local server behind a tunnel is not a contract.

    `wasThinking` reports that the model produced reasoning but no answer,
    which is a different failure from a genuinely empty reply and gets its own
    message to the admin. The chain-of-thought itself is deliberately NOT
    returned as the answer: it's working-out, not a reply, and showing it would
    look like the assistant had answered when it hadn't. */
function extractText(body: unknown): { text: string | null; wasThinking: boolean } {
  const none = { text: null, wasThinking: false };
  if (typeof body !== "object" || body === null) return none;
  const choices = (body as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return none;
  const message = (choices[0] as { message?: unknown }).message;
  if (typeof message !== "object" || message === null) return none;

  const reasoning = (message as { reasoning_content?: unknown }).reasoning_content;
  const wasThinking = typeof reasoning === "string" && reasoning.trim() !== "";

  const content = (message as { content?: unknown }).content;
  if (typeof content !== "string") return { text: null, wasThinking };
  const trimmed = content.trim();
  return { text: trimmed === "" ? null : trimmed, wasThinking };
}
