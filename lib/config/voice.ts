/* PROJECT E.V. — voice synthesis configuration: FREE Edge Read Aloud first,
   Fish Audio as optional premium.
   Free path (no key): lib/server/edge-tts.ts speaks the WebSocket endpoint
   below with a Neural voice Name (e.g. en-US-AriaNeural), falling back to
   the Google Translate TTS proxy. Endpoint shape verified 2026-10-12 against
   https://github.com/rany2/edge-tts (MIT):
     wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1
       ?TrustedClientToken=<token>&ConnectionId=<id>&Sec-MS-GEC=<token>
       &Sec-MS-GEC-Version=1-<chromium-version>
   Fish path (premium): https://docs.fish.audio
   Endpoint verified 2026-10-12 against
   https://docs.fish.audio/api-reference/endpoint/openapi-v1/text-to-speech :
     POST https://api.fish.audio/v1/tts
     headers: `Authorization: Bearer <FISH_API_KEY>`, `Content-Type: application/json`
              optional `model` header (e.g. s2.1-pro-free; omitted = Fish default).
     body (JSON): { text, reference_id?, format ("mp3"|"wav"|...), ... }
       - `reference_id` is a Fish voice MODEL ID string for single-speaker
         synthesis (NOT a display name like "nova"). Optional in schema but
         E.V. always sends one so the spoken voice never changes silently.
   Voice selection end-to-end: settings.ttsVoice -> POST { voice } /
   x-fish-voice. A `voice` matching <lang>-<REGION>-*Neural is a free Edge
   voice Name; anything else is treated as a Fish reference_id (premium path,
   requires a key). This module is client-safe: env accessors below are only
   CALLED server-side. NEVER call getFishApiKey() from client components. */

import type { FishVoicePreset } from "@/lib/types";

/** Native Fish Audio TTS endpoint. Env override: FISH_AUDIO_API_URL. */
export const FISH_AUDIO_API_URL =
  process.env.FISH_AUDIO_API_URL?.trim() || "https://api.fish.audio/v1/tts";

export const FISH_SETUP_HINT =
  "Enter your Fish Audio API key in Settings (Voice section) or set FISH_AUDIO_API_KEY in .env.local. Get a key on your https://fish.audio dashboard.";

export const FISH_VOICE_HINT =
  "Pick a Fish Audio voice in Settings (Voice section): paste a voice model reference_id, or set FISH_AUDIO_VOICE in .env.local. Find model IDs on your fish.audio dashboard under your voices.";

/**
 * Server-only secret accessor. NEVER import from client components, NEVER
 * prefix with NEXT_PUBLIC_, NEVER return to the browser.
 */
export function getFishApiKey(): string | null {
  const key = process.env.FISH_AUDIO_API_KEY?.trim();
  return key ? key : null;
}

/**
 * Configurable server default voice (a Fish reference_id / model ID).
 * Env: FISH_AUDIO_VOICE. Empty string = not configured; callers then
 * require an explicit voice instead of guessing one.
 */
export function getFishDefaultVoice(): string {
  return process.env.FISH_AUDIO_VOICE?.trim() ?? "";
}

/** Optional Fish TTS model override sent as the `model` header. Env: FISH_AUDIO_MODEL. */
export const FISH_AUDIO_MODEL = process.env.FISH_AUDIO_MODEL?.trim() || null;
/* ---- Fish-quality voices via OpenRouter (no Fish key needed). ---- */

/**
 * OpenRouter-hosted Fish TTS model. Env override: OPENROUTER_TTS_MODEL.
 * Uses the owner's existing OpenRouter key (OPENROUTER_API_KEY); no Fish
 * Audio key or credits needed. Screenshot contract 2026-10-12:
 * POST {OPENROUTER_BASE}/audio/speech { model, input, voice, response_format }.
 */
export const OPENROUTER_FISH_MODEL_DEFAULT =
  process.env.OPENROUTER_TTS_MODEL?.trim() || "fish-audio/s2.1-pro-free:free";

/** Effective OpenRouter TTS model (env override or the free Fish default). Never "". */
export function getOpenRouterTtsModel(): string {
  return process.env.OPENROUTER_TTS_MODEL?.trim() || OPENROUTER_FISH_MODEL_DEFAULT;
}

/**
 * Server-only OpenRouter secret for the TTS route. Mirrors
 * getOpenRouterApiKey() in lib/config/models.ts (duplicated here so this
 * client-imported config module never pulls a second config file into the
 * browser bundle). NEVER call from client components.
 */
export function getOpenRouterKeyForTts(): string | null {
  const key = process.env.OPENROUTER_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim();
  return key ? key : null;
}

/* ---- Optional key-gated providers (free tiers, never required). ---- */

/**
 * ElevenLabs free tier (https://elevenlabs.io — free ~10k chars/month).
 * Endpoint shape per https://elevenlabs.io/docs/api-reference/text-to-speech :
 *   POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}
 *   headers: `xi-api-key: <key>`, `Content-Type: application/json`
 *   body: { text, model_id, voice_settings? }. Key-gated, never required.
 */
export const ELEVENLABS_TTS_URL = "https://api.elevenlabs.io/v1/text-to-speech";
export const ELEVENLABS_MODEL_ID = "eleven_turbo_v2_5";

/** Server-only ElevenLabs secret. NEVER call from client components. */
export function getElevenLabsApiKey(): string | null {
  const key = process.env.ELEVENLABS_API_KEY?.trim() ?? "";
  return key.length > 0 ? key : null;
}

/** Optional ElevenLabs default voice_id. Env: ELEVENLABS_VOICE_ID. */
export function getElevenLabsDefaultVoice(): string {
  return process.env.ELEVENLABS_VOICE_ID?.trim() ?? "";
}

/**
 * Azure Speech free tier F0 (https://azure.microsoft.com — 500k chars/month free).
 * Endpoint shape per https://learn.microsoft.com/azure/ai-services/speech-service/rest-text-to-speech :
 *   POST https://{region}.tts.speech.microsoft.com/cognitiveservices/v1
 *   headers: `Ocp-Apim-Subscription-Key: <key>`, SSML body. Same Neural
 *   voice pool as Edge but official + higher quota. Key-gated, never required.
 */
export function getAzureSpeechKey(): string | null {
  const key = process.env.AZURE_SPEECH_KEY?.trim() ?? "";
  return key.length > 0 ? key : null;
}

/** Azure Speech region (e.g. southeastasia). Env: AZURE_SPEECH_REGION. */
export function getAzureSpeechRegion(): string {
  return process.env.AZURE_SPEECH_REGION?.trim() ?? "";
}
/* ---- Free Edge Read Aloud TTS (no key, default provider). ---- */

/**
 * Edge Read Aloud synthesis endpoint: WebSocket ONLY (plain HTTPS POST 404s,
 * verified 2026-10-12). Query carries the public client token plus a
 * per-connection Sec-MS-GEC token (see lib/server/edge-tts.ts).
 */
export const EDGE_TTS_WSS_URL =
  "wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1" +
  "?TrustedClientToken=6A5AA1D4EAFF4E9FB37E23D68491D6F4";

/** Fixed public client token baked into Edge (not a secret; hash input too). */
export const EDGE_TTS_TRUSTED_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";

/** Must track a current Chromium version or the handshake is rejected. */
export const EDGE_TTS_SEC_MS_GEC_VERSION = "1-143.0.3650.75";

/** Requested Edge output; the route returns it verbatim as audio/mpeg. */
export const EDGE_TTS_OUTPUT_FORMAT = "audio-24khz-48kbitrate-mono-mp3";

/** A free Edge voice slot: `id` is the Neural voice Name sent in the SSML. */
export interface FreeVoicePreset {
  id: string;
  name: string;
  desc: string;
  lang: string;
}

/** Hanni-inspired free voice: SG LunaNeural, youthful bright female. */
export const HANNI_VOICE_ID = "en-SG-LunaNeural";

/** Hanni tuning applied when Luna is selected without explicit overrides. */
export const HANNI_TUNING = {
  ratePct: "+8%",
  pitchPct: "+12%",
  style: "cheerful",
  styleDegree: 1,
} as const;

/** Quality free voices; Hanni (opt-in) first, Aria stays the server default. */
export const FREE_VOICE_PRESETS: FreeVoicePreset[] = [
  { id: HANNI_VOICE_ID, name: "Hanni (inspired)", desc: "SG female · bright youthful · free", lang: "en-SG" },
  { id: "en-US-AriaNeural", name: "Aria", desc: "Warm US female", lang: "en-US" },
  { id: "en-US-JennyNeural", name: "Jenny", desc: "Friendly US female", lang: "en-US" },
  { id: "en-US-GuyNeural", name: "Guy", desc: "Calm US male", lang: "en-US" },
  {
    id: "en-US-ChristopherNeural",
    name: "Christopher",
    desc: "Deep US male narrator",
    lang: "en-US",
  },
  { id: "en-GB-SoniaNeural", name: "Sonia", desc: "Warm British female", lang: "en-GB" },
  { id: "en-GB-RyanNeural", name: "Ryan", desc: "Clear British male", lang: "en-GB" },
];

/** Server-chosen voice when the request names none. Aria stays the default. */
export const DEFAULT_FREE_VOICE = "en-US-AriaNeural";

/**
 * Configurable free default voice. Env: FREE_TTS_VOICE (a Neural voice Name).
 * Blank/invalid values fall back to DEFAULT_FREE_VOICE, never to "".
 */
export function getFreeDefaultVoice(): string {
  const override = process.env.FREE_TTS_VOICE?.trim() ?? "";
  return isFreeVoiceId(override) ? override : DEFAULT_FREE_VOICE;
}

/** Short Edge voice Name form: en-US-AriaNeural (lang-REGION-*Neural). */
const FREE_VOICE_PATTERN = /^[a-z]{2,}-[A-Z]{2,}-[A-Za-z0-9-]+Neural$/;

/** True for Edge Neural voice Names (the free path); anything else routes premium. */
export function isFreeVoiceId(value?: string | null): boolean {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 && FREE_VOICE_PATTERN.test(trimmed);
}

/**
 * True for a usable Fish voice MODEL id: non-blank and NOT an Edge Neural
 * voice Name. This is the gate that keeps a free voice out of the
 * Fish-via-OpenRouter path and keeps a Fish id out of the free path.
 */
export function isFishModelId(value?: string | null): boolean {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 && !isFreeVoiceId(trimmed);
}

/** What to do when a Fish voice is selected but the OpenRouter key is missing. */
export const OPENROUTER_FISH_SETUP_HINT =
  "Add your OpenRouter API key in Settings (API section) or set OPENROUTER_API_KEY in .env.local, then retry. E.V. will not silently speak the free voice while a Fish voice is selected.";
/**
 * Pre-Fish OpenAI voice names (nova, alloy, ...). Old browser settings may
 * still store one; treat it as "no explicit voice" so a stale name can never
 * be sent as a Fish reference_id.
 */
const LEGACY_OPENAI_VOICES: Record<string, true> = {
  alloy: true,
  ash: true,
  ballad: true,
  coral: true,
  echo: true,
  sage: true,
  shimmer: true,
  verse: true,
  nova: true,
  onyx: true,
  fable: true,
  marin: true,
  cedar: true,
};

export function isLegacyVoiceId(value?: string | null): boolean {
  const trimmed = value?.trim().toLowerCase() ?? "";
  return trimmed.length > 0 && LEGACY_OPENAI_VOICES[trimmed] === true;
}

/**
 * Normalize a requested voice to a Fish reference_id. Returns "" when the
 * input is blank or a legacy OpenAI voice name (caller falls back to the
 * server default or reports voice_required — never sends the raw name).
 */
export function normalizeVoiceId(value?: string | null): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed || isLegacyVoiceId(trimmed)) return "";
  return trimmed;
}

/**
 * Editable preset slots for the Settings UI.
 * EDIT ME: paste your own fish.audio voice model IDs as `referenceId`
 * (or fill them in Settings -> Voice, which persists per browser).
 * Empty referenceId = slot not configured (its pill is disabled).
 */
export const DEFAULT_FISH_VOICE_PRESETS: FishVoicePreset[] = [
  {
    slot: "primary",
    name: "Primary",
    desc: "Everyday E.V. voice",
    referenceId: "",
  },
  {
    slot: "secondary",
    name: "Secondary",
    desc: "Alternate voice",
    referenceId: "",
  },
  {
    slot: "narrator",
    name: "Narrator",
    desc: "Reading / long-form voice",
    referenceId: "",
  },
];

/** Preset slots whose referenceId is filled in (the pills the UI renders). */
export function configuredPresets(
  presets: FishVoicePreset[] | undefined,
): FishVoicePreset[] {
  const list = presets ?? DEFAULT_FISH_VOICE_PRESETS;
  const configured: FishVoicePreset[] = [];
  for (const p of list) {
    if (p.referenceId.trim().length > 0) configured.push(p);
  }
  return configured;
}
