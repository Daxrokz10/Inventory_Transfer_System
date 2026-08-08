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

const DEFAULT_TIMEOUT_MS = 25_000;

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

  try {
    const res = await fetch(`${base.replace(/\/$/, "")}/chat/completions`, {
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
        messages,
        temperature: opts.temperature ?? 0.2,
        max_tokens: opts.maxTokens ?? 900,
        stream: false,
      }),
    });

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
    const text = extractText(body);
    if (!text) {
      return { ok: false, error: "The assistant returned an empty response." };
    }
    return { ok: true, text };
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

/** Pull the assistant text out of an OpenAI-shaped response without
    trusting its shape — a local server behind a tunnel is not a contract. */
function extractText(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const choices = (body as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const message = (choices[0] as { message?: unknown }).message;
  if (typeof message !== "object" || message === null) return null;
  const content = (message as { content?: unknown }).content;
  if (typeof content !== "string") return null;
  const trimmed = content.trim();
  return trimmed === "" ? null : trimmed;
}
