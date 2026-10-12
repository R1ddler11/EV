/* PROJECT E.V. — centralized model + backend configuration (backend-owned).
   All OpenAI model IDs live here as documented defaults, overridable via env.
   Never scatter model IDs through routes or tools — import from here.
   Docs checked 2026-10-12 against https://developers.openai.com/api/docs/models
   and https://developers.openai.com/api/docs/guides/realtime . */

export const DOCS_CHECKED_DATE = "2026-10-12";

/** Default text model: balances intelligence and cost for OpenRouter. */
export const DEFAULT_TEXT_MODEL = "anthropic/claude-3.5-sonnet";

/** Supported / popular models for OpenRouter */
export const POPULAR_OPENROUTER_MODELS = [
  "anthropic/claude-3.5-sonnet",
  "openai/gpt-4o",
  "openai/gpt-4o-mini",
  "meta-llama/llama-3.3-70b-instruct",
  "google/gemini-2.0-flash-exp:free",
  "deepseek/deepseek-chat",
] as const;
export type PopularOpenRouterModel = (typeof POPULAR_OPENROUTER_MODELS)[number];
/** Current GA speech-to-speech Realtime model. Env override: OPENAI_REALTIME_MODEL. */
export const DEFAULT_REALTIME_MODEL = "gpt-realtime-2.1";
/** Warm, composed Realtime voice. Env override: OPENAI_REALTIME_VOICE. */
export const DEFAULT_REALTIME_VOICE = "marin";

export const SUPPORTED_REALTIME_VOICES = [
  "alloy",
  "ash",
  "ballad",
  "coral",
  "echo",
  "sage",
  "shimmer",
  "verse",
  "marin",
  "cedar",
] as const;
export type RealtimeVoice = (typeof SUPPORTED_REALTIME_VOICES)[number];

function envName(key: string): string | undefined {
  const value = process.env[key]?.trim();
  return value ? value : undefined;
}

export function getTextModel(customModel?: string): string {
  if (customModel && customModel.trim().length > 0) {
    return customModel.trim();
  }
  return (
    envName("OPENROUTER_MODEL") ??
    envName("OPENAI_TEXT_MODEL") ??
    DEFAULT_TEXT_MODEL
  );
}

export function getRealtimeModel(): string {
  return envName("OPENAI_REALTIME_MODEL") ?? DEFAULT_REALTIME_MODEL;
}

export function getRealtimeVoice(): RealtimeVoice {
  const voice = envName("OPENAI_REALTIME_VOICE");
  if (voice && (SUPPORTED_REALTIME_VOICES as readonly string[]).includes(voice)) {
    return voice as RealtimeVoice;
  }
  return DEFAULT_REALTIME_VOICE;
}

/**
 * Server-only secret accessor. NEVER import from client components, NEVER
 * prefix with NEXT_PUBLIC_, NEVER return to the browser.
 */
/**
 * Server-only secret accessor for OpenRouter.
 * Reads OPENROUTER_API_KEY from process.env (falls back to OPENAI_API_KEY for backwards compatibility).
 */
export function getOpenRouterApiKey(): string | null {
  const key =
    process.env.OPENROUTER_API_KEY?.trim() ||
    process.env.OPENAI_API_KEY?.trim();
  return key ? key : null;
}

export function isOpenRouterConfigured(customKey?: string): boolean {
  if (customKey && customKey.trim().length > 0) return true;
  return getOpenRouterApiKey() !== null;
}

export function getOpenAIApiKey(): string | null {
  const key = process.env.OPENAI_API_KEY?.trim();
  return key ? key : null;
}

export function isOpenAIConfigured(): boolean {
  return getOpenAIApiKey() !== null;
}

/** Intentional context window: only the tail of history reaches the model. */
export const CHAT_CONTEXT_WINDOW = 20;
/** Hard cap on inbound messages per request (abuse guard). */
export const CHAT_MAX_MESSAGES = 100;
export const CHAT_MAX_CONTENT_CHARS = 20000;
/** Overall server-side budget for one streaming chat request. */
export const CHAT_REQUEST_TIMEOUT_MS = 120_000;
/** Max Responses API rounds (initial + tool follow-ups) per request. */
export const MAX_TOOL_ROUNDS = 4;

/** Ephemeral Realtime secret TTL (API allows 10–7200s; 10 min default). */
export const VOICE_SECRET_TTL_SECONDS = 600;
/** Browser WebRTC endpoint: SDP offer POSTed here with the ephemeral token. */
export const REALTIME_WEBRTC_URL = "https://api.openai.com/v1/realtime/calls";

export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
export const OPENROUTER_DEFAULT_HEADERS = {
  "HTTP-Referer": "http://localhost:3000",
  "X-Title": "E.V. Companion",
};
export const OPENROUTER_SETUP_HINT =
  "Enter your OpenRouter API key in UI Settings or add OPENROUTER_API_KEY to .env.local.";
export const SETUP_HINT =
  "Add OPENAI_API_KEY to .env.local (copy from .env.example), then restart `pnpm dev`.";
