/* PROJECT E.V. — backend integration hooks (frontend-owned).
   ------------------------------------------------------------------
   CONTRACT for the backend worker (owns app/api/*, lib/ai/*, lib/tools/*):
   - GET  /api/chat → 200 { status: "ready" | "setup-required", hint? }.
     Never 404 while mounted. Probe reads `status`, not just reachability.
   - POST /api/chat accepts { messages, conversationId?, mode?, notes?,
     memories?, memorySummary? } and returns EITHER { reply } JSON (fail-fast
     errors use non-2xx JSON { error, code, hint }) OR a text/event-stream SSE
     feed of `data: {"token": "<piece>"}` lines, `data: {"ui": {...}}`
     tool-action lines (NEVER chat text — see UiAction), ending with
     `data: [DONE]`. `mode` is "daily" (default when absent) or "builder" and
     only selects the system instructions.
   - POST /api/voice/session accepts { context?, memories? } → 201
     { clientSecret, expiresAt, realtimeUrl, webrtc, session }.
     Missing key → 503 { error, code, hint }; bad key → 500 {…}.
   The UI NEVER fakes a connection — failures surface as honest error states.
   ------------------------------------------------------------------ */

import type { UiAction } from "@/lib/tools/handlers";
import type { ChatMode } from "@/lib/types";

export type { UiAction };

export interface ChatPayloadMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface ChatRequestExtra {
  conversationId?: string;
  mode?: ChatMode;
  notes?: { id?: string; title: string; body: string }[];
  memories?: { text: string; enabled?: boolean }[];
  memorySummary?: string;
}

export class BackendUnavailableError extends Error {
  hint: string;
  code?: string;
  constructor(message: string, hint: string, code?: string) {
    super(message);
    this.name = "BackendUnavailableError";
    this.hint = hint;
    this.code = code;
  }
}

const CHAT_UNAVAILABLE = "Could not reach the E.V. intelligence backend.";
const CHAT_HINT =
  "The /api/chat route is not answering. Start or repair the backend worker's API, then retry. Your text is preserved — nothing was sent.";

function summarizeHttp(status: number): string {
  if (status === 404)
    return "The route returned 404 — the backend worker has not mounted it yet.";
  if (status === 500)
    return "The route returned 500 — the backend threw while handling the request.";
  return `The route returned HTTP ${status}.`;
}

interface ErrorBody {
  error?: unknown;
  hint?: unknown;
  code?: unknown;
}

/** Best-effort parse of a non-2xx JSON { error, hint, code } body. */
async function readErrorBody(response: Response): Promise<ErrorBody | null> {
  try {
    const data: unknown = await response.json();
    if (data && typeof data === "object") return data as ErrorBody;
    return null;
  } catch {
    return null;
  }
}

function errorFromBody(
  body: ErrorBody | null,
  fallbackMessage: string,
  status: number,
): BackendUnavailableError {
  const message =
    body && typeof body.error === "string" && body.error
      ? body.error
      : fallbackMessage;
  const hint =
    body && typeof body.hint === "string" && body.hint
      ? body.hint
      : summarizeHttp(status);
  const code = body && typeof body.code === "string" ? body.code : undefined;
  return new BackendUnavailableError(message, hint, code);
}

export interface StreamOptions {
  apiKey?: string;
  model?: string;
  signal?: AbortSignal;
  onToken?: (token: string) => void;
  /** Fired for every `data: {"ui": …}` line — never chat text. */
  onUi?: (action: UiAction) => void;
  /** Vault context the backend tools (search_notes/get_memories) can see. */
  extra?: ChatRequestExtra;
}

export interface StreamResult {
  text: string;
  uiActions: UiAction[];
}

/** A parsed SSE object carrying a UI action for the frontend to execute. */
function asUiAction(parsed: unknown): UiAction | null {
  if (!parsed || typeof parsed !== "object") return null;
  if (!("ui" in parsed)) return null;
  const ui: unknown = parsed.ui;
  if (!ui || typeof ui !== "object") return null;
  if (!("kind" in ui) || typeof ui.kind !== "string") return null;
  return ui as UiAction;
}

/**
 * POST /api/chat with transparent JSON-or-SSE handling.
 * `ui` events are collected and emitted via onUi — they NEVER enter the text.
 */
export async function postChatStream(
  messages: ChatPayloadMessage[],
  opts: StreamOptions = {},
): Promise<StreamResult> {
  let response: Response;
  try {
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    if (opts.apiKey) {
      headers["x-openrouter-key"] = opts.apiKey;
    }
    if (opts.model) {
      headers["x-openrouter-model"] = opts.model;
    }
    response = await fetch("/api/chat", {
      method: "POST",
      headers,
      body: JSON.stringify({
        messages,
        apiKey: opts.apiKey,
        model: opts.model,
        ...(opts.extra ?? {}),
      }),
      signal: opts.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new BackendUnavailableError(CHAT_UNAVAILABLE, CHAT_HINT);
  }

  if (!response.ok) {
    const body = await readErrorBody(response);
    throw errorFromBody(body, CHAT_UNAVAILABLE, response.status);
  }
  if (!response.body) {
    throw new BackendUnavailableError(
      CHAT_UNAVAILABLE,
      "The route answered with an empty body.",
    );
  }

  const uiActions: UiAction[] = [];
  const emitUi = (action: UiAction) => {
    uiActions.push(action);
    opts.onUi?.(action);
  };

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/event-stream")) {
    const data: unknown = await response.json();
    if (data && typeof data === "object") {
      if ("ui" in data && data.ui && typeof data.ui === "object") {
        const action = asUiAction(data);
        if (action) emitUi(action);
      }
      const record = data as { reply?: unknown; content?: unknown; message?: unknown };
      const candidate = record.reply ?? record.content ?? record.message;
      const text = typeof candidate === "string" ? candidate : "";
      if (!text && uiActions.length === 0) {
        throw new BackendUnavailableError(
          "The backend answered but sent no text.",
          "Inspect the /api/chat response shape against the contract in lib/api.ts.",
        );
      }
      if (text) opts.onToken?.(text);
      return { text, uiActions };
    }
    throw new BackendUnavailableError(
      "The backend answered in an unexpected shape.",
      "Inspect the /api/chat response shape against the contract in lib/api.ts.",
    );
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let full = "";
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const token = trimmed.slice(5).trim();
      if (token === "[DONE]") {
        return { text: full, uiActions };
      }
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(token);
      } catch {
        full += token;
        opts.onToken?.(token);
        continue;
      }
      const ui = asUiAction(parsed);
      if (ui) {
        emitUi(ui);
        continue;
      }
      let piece = token;
      if (parsed && typeof parsed === "object") {
        const record = parsed as { token?: unknown; text?: unknown; delta?: unknown };
        const candidate = record.token ?? record.text ?? record.delta;
        piece = typeof candidate === "string" ? candidate : token;
      } else if (typeof parsed === "string") {
        piece = parsed;
      }
      full += piece;
      if (piece) opts.onToken?.(piece);
    }
  }
  return { text: full, uiActions };
}

export interface ProbeResult {
  /** The route file is mounted (any non-404 answer). */
  mounted: boolean;
  /** GET reported status "ready" — an API key is configured server-side. */
  configured: boolean;
  /** Present when status is "setup-required": the backend's own next step. */
  hint?: string;
}

/** GET /api/chat: mounted = not 404; configured = status "ready". */
export async function probeChatRoute(timeoutMs = 2500): Promise<ProbeResult> {
  const offline: ProbeResult = { mounted: false, configured: false };
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch("/api/chat", {
        method: "GET",
        signal: controller.signal,
        cache: "no-store",
      });
    } finally {
      clearTimeout(timer);
    }
    if (res.status === 404) return offline;
    let status: unknown = null;
    let hint: unknown = null;
    try {
      const data: unknown = await res.json();
      if (data && typeof data === "object") {
        if ("status" in data) status = data.status;
        if ("hint" in data) hint = data.hint;
      }
    } catch {
      return { mounted: true, configured: false };
    }
    return {
      mounted: true,
      configured: status === "ready",
      hint: typeof hint === "string" ? hint : undefined,
    };
  } catch {
    return offline;
  }
}
export type TtsProviderHint = "fish" | "elevenlabs" | "azure" | "free" | "openrouter-fish";

/** Audio container requested from /api/voice/tts. */
export type TtsAudioFormat = "mp3" | "wav";

export interface SpeakTextOptions {
  /** Free voice ID (Edge e.g. en-US-AriaNeural, en-SG-LunaNeural) or a premium reference/voice ID. Omit for the server free default. */
  voice?: string;
  /** Provider-appropriate key: Fish key for the Fish path, ElevenLabs key when provider is "elevenlabs", Azure key when "azure". Absent by default; never send a blank key. The server disambiguates via `provider`. */
  apiKey?: string;
  format?: TtsAudioFormat;
  /** Forwarded to the server so it may answer with the free voice when premium billing/rate limits fail (402/429/5xx). */
  allowFallback?: boolean;
  /** Optional per-request provider hint for the server (e.g. "elevenlabs", "azure"). Omit for the server default routing (free unless a Fish key + reference_id select premium). */
  provider?: TtsProviderHint;
  /** ElevenLabs voice ID to synthesize with when provider is "elevenlabs". Omit otherwise. */
  elevenVoiceId?: string;
  /** ElevenLabs per-request key override (optional). Prefer the persisted Settings key. */
  elevenKey?: string;
  /** Azure per-request key override (optional). Prefer the persisted Settings key. */
  azureKey?: string;
  /** Azure per-request region override, e.g. southeastasia (optional). */
  azureRegion?: string;
  /** OpenRouter per-request key override for provider "openrouter-fish" (optional). Prefer the persisted Settings key. */
  openRouterKey?: string;
  /**
   * Fish voice model id to synthesize with when provider is "openrouter-fish"
   * (a Fish reference_id, e.g. the hex id from the OpenRouter playground).
   * Setting this together with provider "openrouter-fish" IS the explicit
   * "E.V. speaks this Fish voice" selection: `voice` is then omitted, and the
   * server answers setup_required (503) instead of silently using the free
   * voice when no OpenRouter key is resolvable. Omit otherwise.
   */
  fishVoiceId?: string;
  /** Optional speaking-style hint for providers that support styles (e.g. "cheerful"). Omit for the provider default. */
  style?: string;
  /** Expressive style strength 0-2 for providers that support it. Omit for default. */
  styleDegree?: number;
  /** Prosody rate nudge, "+8%"-style, clamped to ±50% server-side. Omit for default. */
  ratePct?: string;
  /** Prosody pitch nudge, "+12%"-style, clamped to ±50% server-side. Omit for default. */
  pitchPct?: string;
}

/**
 * POST /api/voice/tts -> spoken audio for `text`. Free by default, no key needed:
 * omit `voice` for the server free default, omit keys unless the user actually
 * configured one for the active provider path. Forwards voice + apiKey +
 * format + allowFallback + provider + elevenVoiceId/elevenKey +
 * azureKey/azureRegion + openRouterKey/fishVoiceId +
 * style/styleDegree/ratePct/pitchPct in the JSON body, plus x-tts-provider /
 * provider-appropriate x-*-key headers; the server resolves env fallbacks and
 * free defaults. Fish-via-OpenRouter (provider "openrouter-fish") synthesizes
 * Fish-quality audio through the free OpenRouter model fish-audio/s2.1-pro-free:free
 * using the OpenRouter key — no Fish key needed.
 * Throws BackendUnavailableError carrying the server's own error/hint/code.
 */
export async function speakText(
  text: string,
  opts: SpeakTextOptions = {},
): Promise<{ blob: Blob; voice: string | null; provider: string | null }> {
  const edgeVoice = opts.voice?.trim() || undefined;
  const apiKey = opts.apiKey?.trim() || undefined;
  const elevenKey = opts.elevenKey?.trim() || undefined;
  const elevenVoiceId = opts.elevenVoiceId?.trim() || undefined;
  const azureKey = opts.azureKey?.trim() || undefined;
  const azureRegion = opts.azureRegion?.trim() || undefined;
  const openRouterKey = opts.openRouterKey?.trim() || undefined;
  const fishVoiceId = opts.fishVoiceId?.trim() || undefined;
  // A selected Fish voice (provider "openrouter-fish" + a Fish voice model id)
  // IS the chosen voice: drop any Edge Neural `voice` so the server can never
  // be asked to speak the free name while a Fish voice is selected. The Fish
  // id itself is never sent as `voice` — it travels as `fishVoiceId` only.
  const fishSelected = opts.provider === "openrouter-fish" && Boolean(fishVoiceId);
  const voice = fishSelected ? undefined : edgeVoice;
  const style = opts.style?.trim() || undefined;
  const ratePct = opts.ratePct?.trim() || undefined;
  const pitchPct = opts.pitchPct?.trim() || undefined;
  let response: Response;
  try {
    response = await fetch("/api/voice/tts", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(opts.provider ? { "x-tts-provider": opts.provider } : {}),
        ...(apiKey ? { "x-fish-key": apiKey } : {}),
        ...(elevenKey ? { "x-elevenlabs-key": elevenKey } : {}),
        ...(elevenVoiceId ? { "x-elevenlabs-voice": elevenVoiceId } : {}),
        ...(azureKey ? { "x-azure-key": azureKey } : {}),
        ...(azureRegion ? { "x-azure-region": azureRegion } : {}),
        ...(openRouterKey ? { "x-openrouter-key": openRouterKey } : {}),
        ...(fishVoiceId ? { "x-fish-voice-id": fishVoiceId } : {}),
        ...(voice ? { "x-fish-voice": voice } : {}),
      },
      body: JSON.stringify({
        text,
        ...(voice ? { voice } : {}),
        ...(apiKey ? { apiKey } : {}),
        ...(opts.format ? { format: opts.format } : {}),
        ...(opts.allowFallback ? { allowFallback: true } : {}),
        ...(opts.provider ? { provider: opts.provider } : {}),
        ...(elevenVoiceId ? { elevenVoiceId } : {}),
        ...(elevenKey ? { elevenKey } : {}),
        ...(azureKey ? { azureKey } : {}),
        ...(azureRegion ? { azureRegion } : {}),
        ...(openRouterKey ? { openRouterKey } : {}),
        ...(fishVoiceId ? { fishVoiceId } : {}),
        ...(style ? { style } : {}),
        ...(typeof opts.styleDegree === "number" ? { styleDegree: opts.styleDegree } : {}),
        ...(ratePct ? { ratePct } : {}),
        ...(pitchPct ? { pitchPct } : {}),
      }),
    });
  } catch {
    throw new BackendUnavailableError(
      "Speech synthesis is unavailable.",
      "The /api/voice/tts route is not answering (network failure). Check the dev server, then retry.",
    );
  }
  if (!response.ok) {
    const body = await readErrorBody(response);
    throw errorFromBody(
      body,
      "Speech synthesis is unavailable.",
      response.status,
    );
  }
  const blob = await response.blob();
  return {
    blob,
    voice: response.headers.get("x-tts-voice"),
    provider: response.headers.get("x-tts-provider"),
  };
}

 export interface VoiceSessionPayload {
  clientSecret: string;
  expiresAt?: number;
  realtimeUrl: string;
  webrtc?: { url?: string; dataChannel?: string };
  session?: { model?: string; voice?: string; [key: string]: unknown };
  [key: string]: unknown;
}

function asVoiceSession(data: unknown): VoiceSessionPayload | null {
  if (!data || typeof data !== "object") return null;
  const record = data as Record<string, unknown>;
  if (typeof record.clientSecret !== "string" || !record.clientSecret) return null;
  if (typeof record.realtimeUrl !== "string" || !record.realtimeUrl) return null;
  return data as VoiceSessionPayload;
}

/**
 * POST /api/voice/session with optional text context + approved memories.
 * Throws BackendUnavailableError carrying the server's own error/hint —
 * 503 setup_required (no key), 500 invalid_credentials (bad key), etc.
 */
export async function createVoiceSession(
  contextMessages: ChatPayloadMessage[] = [],
  memories: { text: string }[] = [],
): Promise<VoiceSessionPayload> {
  let response: Response;
  try {
    response = await fetch("/api/voice/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ context: contextMessages, memories }),
    });
  } catch {
    throw new BackendUnavailableError(
      "Realtime voice link is unavailable.",
      "The /api/voice/session route is not answering (network failure). Check the dev server, then retry. Text conversation keeps working — no transcript was lost.",
    );
  }
  if (!response.ok) {
    const body = await readErrorBody(response);
    throw errorFromBody(
      body,
      "Realtime voice link is unavailable.",
      response.status,
    );
  }
  let data: unknown = null;
  try {
    data = await response.json();
  } catch {
    throw new BackendUnavailableError(
      "Realtime voice link answered in an unexpected shape.",
      "Inspect the /api/voice/session response against the contract in lib/api.ts.",
    );
  }
  const session = asVoiceSession(data);
  if (!session) {
    throw new BackendUnavailableError(
      "Realtime voice link answered without a session.",
      "The route replied 201 but carried no clientSecret/realtimeUrl. Check the backend worker's session minting.",
    );
  }
  return session;
}
