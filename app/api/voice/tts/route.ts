/* PROJECT E.V. — Text-to-Speech API route (POST /api/voice/tts, GET /api/voice/tts).
   FREE by default: Edge Read Aloud TTS (WebSocket, Neural voice Name, no key)
   is the primary provider; the Google Translate TTS proxy is the secondary
   free provider. Fish Audio, ElevenLabs (free 10k chars/mo @ elevenlabs.io),
   Azure Speech F0 (free 500k chars/mo), and Fish-via-OpenRouter (the
   OpenRouter key the owner already has — no Fish key needed) stay OPTIONAL
   key-gated providers, tried before the free path only when their key +
   voice/region are supplied (body fields, x-*-* headers, or server env).
   Keyed 402/429/5xx + network failures AUTOMATICALLY fall through to the
   free path. Keyed 401/422 stay honest errors and never fall back. No
   credentials at all -> the free path directly; 503 is gone — 502
   provider_error fires only when ALL free providers are unreachable. `voice`
   is a Fish reference_id (Fish / openrouter-fish paths), an ElevenLabs
   voice_id (ElevenLabs path), or a free Edge voice Name (e.g.
   en-US-AriaNeural, en-SG-LunaNeural for the Hanni-inspired preset).
   Responses carry X-TTS-Provider (fish-audio | openrouter-fish | elevenlabs |
   azure | edge-tts | fallback-translate) and X-TTS-Voice (the voice used).
   Errors never echo keys; provider error bodies are capped at ~2KB. */

import { NextResponse } from "next/server";
import { z } from "zod";
import {
  FISH_AUDIO_API_URL,
  FISH_AUDIO_MODEL,
  FREE_VOICE_PRESETS,
  HANNI_TUNING,
  HANNI_VOICE_ID,
  getAzureSpeechKey,
  getAzureSpeechRegion,
  getElevenLabsApiKey,
  getElevenLabsDefaultVoice,
  getFishApiKey,
  getFishDefaultVoice,
  getFreeDefaultVoice,
  getOpenRouterKeyForTts,
  getOpenRouterTtsModel,
  isFreeVoiceId,
  isFishModelId,
  OPENROUTER_FISH_SETUP_HINT,
  normalizeVoiceId,
} from "@/lib/config/voice";
import { synthesizeEdgeTts, type EdgeTtsTuning } from "@/lib/server/edge-tts";
import { synthesizeElevenLabs } from "@/lib/server/elevenlabs";
import { synthesizeAzureSpeech } from "@/lib/server/azure-speech";
import { synthesizeOpenRouterFish } from "@/lib/server/openrouter-tts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PROVIDERS = ["fish", "openrouter-fish", "elevenlabs", "azure", "free"] as const;
type ProviderHint = (typeof PROVIDERS)[number];

const TtsBody = z.object({
  text: z.string().min(1).max(4000),
  voice: z.string().max(200).optional(),
  apiKey: z.string().max(500).optional(),
  format: z.enum(["mp3", "wav"]).optional(),
  // Accepted for backwards compatibility; the free fallback is now automatic
  // so this flag is always treated as true.
  allowFallback: z.boolean().optional(),
  /** Explicit provider choice; wins over credential-sniffed priority. */
  provider: z.enum(PROVIDERS).optional(),
  /** Free-path expressive style (cheerful|friendly|excited|hopeful|gentle). */
  style: z.string().max(30).optional(),
  styleDegree: z.number().min(0).max(2).optional(),
  ratePct: z.string().max(12).optional(),
  pitchPct: z.string().max(12).optional(),
  /** ElevenLabs per-request key + voice_id overrides. */
  elevenKey: z.string().max(500).optional(),
  elevenVoiceId: z.string().max(200).optional(),
  /** Azure per-request key + region overrides. */
  azureKey: z.string().max(500).optional(),
  azureRegion: z.string().max(80).optional(),
  /** Fish-via-OpenRouter per-request key + Fish voice MODEL id overrides. */
  openRouterKey: z.string().max(500).optional(),
  fishVoiceId: z.string().max(200).optional(),
});

/** Status probe: never leaks keys. */
export async function GET() {
  return NextResponse.json({
    ready: true,
    provider:
      "free (edge-tts primary; openrouter-fish/elevenlabs/azure/fish optional)",
    voices: FREE_VOICE_PRESETS.map((preset) => preset.id),
    premium: {
      elevenlabs: { hasKey: Boolean(getElevenLabsApiKey()) },
      azure: { hasKey: Boolean(getAzureSpeechKey()), region: getAzureSpeechRegion() || null },
      fish: { hasKey: Boolean(getFishApiKey()) },
      openrouterFish: {
        hasKey: Boolean(getOpenRouterKeyForTts()),
        model: getOpenRouterTtsModel(),
      },
    },
    defaultVoice: getFreeDefaultVoice(),
    freeFallback: { available: true },
  });
}

/**
 * Map a Fish Audio error status to an honest, key-free client response.
 * Reads at most ~2KB so a binary body is never buffered into an error.
 */
async function fishErrorResponse(status: number, res: Response) {
  let detail = "";
  try {
    const text = await res.text();
    if (text) {
      try {
        const parsed = JSON.parse(text) as { message?: unknown };
        if (typeof parsed.message === "string" && parsed.message.length > 0) {
          detail = parsed.message.slice(0, 300);
        }
      } catch {
        detail = text.slice(0, 300);
      }
    }
  } catch {
    detail = "";
  }

  if (status === 401 || status === 403) {
    return NextResponse.json(
      {
        error: "Fish Audio rejected the API key",
        code: "invalid_credentials",
        hint: "Check the Fish Audio API key in Settings (Voice section) or FISH_AUDIO_API_KEY in .env.local.",
        ...(detail ? { detail } : {}),
      },
      { status: 401 },
    );
  }
  if (status === 402) {
    return NextResponse.json(
      {
        error: "Fish Audio refused the request (billing/quota)",
        code: "billing_required",
        hint: "Your Fish Audio account is out of credits/quota — top up at https://fish.audio dashboard, or use the free browser voice below.",
        fallbackAvailable: true,
        ...(detail ? { detail } : {}),
      },
      { status: 402 },
    );
  }
  if (status === 429) {
    return NextResponse.json(
      {
        error: "Fish Audio rate limit reached",
        code: "rate_limited",
        hint: "Wait a moment and retry.",
        ...(detail ? { detail } : {}),
      },
      { status: 429 },
    );
  }
  if (status === 400 || status === 404 || status === 422) {
    return NextResponse.json(
      {
        error: "Fish Audio rejected the request",
        code: "invalid_request",
        hint: "Check that the voice reference_id is a valid Fish Audio model ID in Settings (Voice section).",
        ...(detail ? { detail } : {}),
      },
      { status },
    );
  }
  return NextResponse.json(
    {
      error: "Fish Audio synthesis failed",
      code: "provider_error",
      hint: "Fish Audio returned an unexpected error; retry shortly.",
      ...(detail ? { detail } : {}),
    },
    { status: 502 },
  );
}
/**
 * Free synthesis, primary first: Edge Read Aloud (WebSocket, no key) with the
 * Neural voice Name, then the Google Translate TTS proxy. Translate text is
 * chunked into ~180-char pieces (per-request limit); pieces concatenate as
 * MP3. 502 provider_error fires only when BOTH free providers fail.
 */
function fallbackReasonFor(status: number): "billing" | "rate_limited" | "provider_error" {
  if (status === 402) return "billing";
  if (status === 429) return "rate_limited";
  return "provider_error";
}

/**
 * Resolve the free voice for this request. An explicit Neural voice Name wins
 * (invalid/legacy names are ignored, never sent anywhere); otherwise the
 * server default (FREE_TTS_VOICE override or AriaNeural). Never "".
 */
function resolveFreeVoice(
  voice?: string | null,
  headerVoice?: string | null,
): string {
  for (const candidate of [voice?.trim(), headerVoice?.trim()]) {
    if (candidate && isFreeVoiceId(candidate)) return candidate;
  }
  return getFreeDefaultVoice();
}

/**
 * Resolve free-path expressive tuning. Explicit ratePct/pitchPct/style win;
 * the Hanni preset (en-SG-LunaNeural) supplies its bright defaults when the
 * caller sends none. All values are clamped/sanitized downstream.
 */
function resolveTuning(
  freeVoice: string,
  opts: { style?: string; styleDegree?: number; ratePct?: string; pitchPct?: string },
): EdgeTtsTuning {
  const isHanni = freeVoice === HANNI_VOICE_ID;
  return {
    style: opts.style?.trim() || (isHanni ? HANNI_TUNING.style : undefined),
    styleDegree: opts.styleDegree ?? (isHanni ? HANNI_TUNING.styleDegree : undefined),
    ratePct: opts.ratePct?.trim() || (isHanni ? HANNI_TUNING.ratePct : undefined),
    pitchPct: opts.pitchPct?.trim() || (isHanni ? HANNI_TUNING.pitchPct : undefined),
  };
}

/** True when the status should fall through to the free path (not honest-error). */
function isFallbackEligible(status: number): boolean {
  return status === 402 || status === 429 || (status >= 500 && status <= 599);
}

function honestKeyedError(
  service: "ElevenLabs" | "Azure Speech" | "OpenRouter",
  status: number,
  detail: string,
) {
  if (status === 401 || status === 403) {
    return NextResponse.json(
      {
        error: `${service} rejected the API key`,
        code: "invalid_credentials",
        hint: `Check the ${service} key in .env.local.`,
        ...(detail ? { detail } : {}),
      },
      { status: 401 },
    );
  }
  return NextResponse.json(
    {
      error: `${service} rejected the request`,
      code: "invalid_request",
      hint: `Check the ${service} voice/region for this request.`,
      ...(detail ? { detail } : {}),
    },
    { status: status >= 400 && status < 500 ? status : 502 },
  );
}

function chunkForFallback(text: string): string[] {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length === 0) return [];
  const chunks: string[] = [];
  let rest = cleaned;
  while (rest.length > 0) {
    if (rest.length <= 180) {
      chunks.push(rest);
      break;
    }
    let cut = rest.lastIndexOf(" ", 180);
    if (cut < 60) cut = 180;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut).trimStart();
  }
  return chunks.slice(0, 20);
}

/**
 * Try the free providers in order. Edge failures log server-side only; the
 * client sees which provider spoke (X-TTS-Provider) or one 502 naming the
 * next step. `fallbackReason` (Fish 402/429/5xx context) rides along as
 * X-TTS-Fallback-Reason when the free path is reached via Fish.
 */
async function freeAudioResponse(
  text: string,
  voice: string,
  fallbackReason?: "billing" | "rate_limited" | "provider_error",
  tuning?: EdgeTtsTuning,
): Promise<Response> {
  try {
    const edge = await synthesizeEdgeTts(text, voice, tuning);
    return new Response(new Uint8Array(edge.audio).buffer as ArrayBuffer, {
      status: 200,
      headers: {
        "Content-Type": edge.contentType,
        "Cache-Control": "public, max-age=3600",
        "X-TTS-Provider": "edge-tts",
        "X-TTS-Voice": edge.voice,
        ...(fallbackReason ? { "X-TTS-Fallback-Reason": fallbackReason } : {}),
      },
    });
  } catch (err) {
    console.error("Edge TTS failed, trying translate proxy:", err);
  }
  return fallbackTranslateAudio(text, voice, fallbackReason ?? "provider_error");
}

async function fallbackTranslateAudio(
  text: string,
  voice: string,
  reason: "billing" | "rate_limited" | "provider_error",
): Promise<Response> {
  const chunks = chunkForFallback(text);
  if (chunks.length === 0) {
    return NextResponse.json(
      { error: "No text to synthesize.", code: "bad_request" },
      { status: 400 },
    );
  }
  const parts: Uint8Array[] = [];
  try {
    for (const chunk of chunks) {
      const url =
        "https://translate.google.com/translate_tts?ie=UTF-8" +
        `&client=tw-ob&tl=en&q=${encodeURIComponent(chunk)}`;
      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0" },
      });
      if (!res.ok) throw new Error(`translate proxy HTTP ${res.status}`);
      parts.push(new Uint8Array(await res.arrayBuffer()));
    }
  } catch (err) {
    console.error("Fallback translate TTS failed:", err);
    return NextResponse.json(
      {
        error: "All voice providers are unreachable",
        code: "provider_error",
        hint: "Both free providers (Edge TTS and the translate proxy) failed — retry shortly. If a Fish Audio key is configured, check network connectivity as well.",
      },
      { status: 502 },
    );
  }
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    combined.set(part, offset);
    offset += part.length;
  }
  return new Response(combined.buffer as ArrayBuffer, {
    status: 200,
    headers: {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "public, max-age=3600",
      "X-TTS-Provider": "fallback-translate",
      "X-TTS-Voice": voice,
      "X-TTS-Fallback-Reason": reason,
    },
  });
}


export async function POST(request: Request) {
  let bodyJson: unknown;
  try {
    bodyJson = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = TtsBody.safeParse(bodyJson);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request payload", details: parsed.error.issues },
      { status: 400 },
    );
  }

  const {
    text,
    voice: requestedVoice,
    apiKey: bodyKey,
    provider: bodyProvider,
    style,
    styleDegree,
    ratePct,
    pitchPct,
    elevenKey: bodyElevenKey,
    elevenVoiceId: bodyElevenVoice,
    azureKey: bodyAzureKey,
    azureRegion: bodyAzureRegion,
    openRouterKey: bodyOpenRouterKey,
    fishVoiceId: bodyFishVoiceId,
  } = parsed.data;
  const headerVoice = request.headers.get("x-fish-voice")?.trim() || null;
  const headerProvider = request.headers.get("x-tts-provider")?.trim().toLowerCase() || null;
  const providerHint: ProviderHint | null =
    bodyProvider ??
    ((PROVIDERS as readonly string[]).includes(headerProvider ?? "")
      ? (headerProvider as ProviderHint)
      : null);

  // Free voice resolution never fails: server default when nothing supplied.
  const freeVoice = resolveFreeVoice(requestedVoice?.trim(), headerVoice);
  // Hanni tuning: Luna without explicit overrides gets the bright preset.
  const tuning = resolveTuning(freeVoice, { style, styleDegree, ratePct, pitchPct });

  // Fish credentials: key + Fish reference_id (free Neural names excluded).
  const apiKey =
    bodyKey?.trim() ||
    request.headers.get("x-fish-key")?.trim() ||
    getFishApiKey();
  const requestedId = normalizeVoiceId(requestedVoice?.trim() || headerVoice || undefined);
  const serverDefault = normalizeVoiceId(getFishDefaultVoice());
  const referenceId = requestedId || serverDefault;
  // Premium Fish path needs BOTH a key and a Fish reference_id. A free Neural
  // voice Name in `voice` selects the free path even when a key exists.
  const fishPathActive =
    Boolean(apiKey) &&
    Boolean(referenceId) &&
    !isFreeVoiceId(requestedVoice?.trim()) &&
    !isFreeVoiceId(headerVoice);

  // ElevenLabs credentials: key + voice_id (per-request overrides win over env).
  const elevenKey =
    bodyElevenKey?.trim() ||
    request.headers.get("x-elevenlabs-key")?.trim() ||
    getElevenLabsApiKey();
  const elevenVoiceId =
    bodyElevenVoice?.trim() ||
    request.headers.get("x-elevenlabs-voice")?.trim() ||
    getElevenLabsDefaultVoice();
  const elevenPathActive = Boolean(elevenKey) && Boolean(elevenVoiceId);

  // Azure credentials: key + region (per-request overrides win over env).
  // The voice is the resolved free Neural Name (same voice pool as Edge).
  const azureKey =
    bodyAzureKey?.trim() ||
    request.headers.get("x-azure-key")?.trim() ||
    getAzureSpeechKey();
  const azureRegion =
    bodyAzureRegion?.trim() ||
    request.headers.get("x-azure-region")?.trim() ||
    getAzureSpeechRegion();
  const azurePathActive = Boolean(azureKey) && Boolean(azureRegion);

  // Fish-via-OpenRouter selection. An explicit Fish voice MODEL id (settings
  // fishVoiceViaOpenRouter, sent as fishVoiceId / x-fish-voice-id) IS the
  // user's chosen voice: it outranks any free Neural name in `voice`, and the
  // request is answered from this path or with an honest error — never with
  // free audio as if the Fish voice had spoken. An Edge Neural voice Name is
  // never a valid Fish id (isFishModelId), so it can neither select this path
  // nor be sent to it as `voice`.
  const openRouterKey =
    bodyOpenRouterKey?.trim() ||
    request.headers.get("x-openrouter-key")?.trim() ||
    getOpenRouterKeyForTts();
  const openRouterHeaderVoice = request.headers.get("x-fish-voice-id")?.trim() || null;
  const explicitOpenRouterVoiceId = bodyFishVoiceId?.trim() || openRouterHeaderVoice || "";
  // Rejected explicit id: the caller sent an Edge Neural name as a Fish id.
  const openRouterIdRejected = explicitOpenRouterVoiceId.length > 0 && !isFishModelId(explicitOpenRouterVoiceId);
  const fishVoiceSelected = isFishModelId(explicitOpenRouterVoiceId);
  const openRouterVoiceId = fishVoiceSelected ? explicitOpenRouterVoiceId : getFishDefaultVoice();
  const openRouterPathActive = Boolean(openRouterKey) && Boolean(openRouterVoiceId);

  // Explicit provider choice wins; a provider without credentials falls
  // through to the automatic priority below (free path never 503s).
  const wants: Record<ProviderHint, boolean> = {
    fish: providerHint === "fish",
    "openrouter-fish": providerHint === "openrouter-fish",
    elevenlabs: providerHint === "elevenlabs",
    azure: providerHint === "azure",
    free: providerHint === "free",
  };
  const explicit = providerHint !== null;

  if (wants.free) {
    return freeAudioResponse(text, freeVoice, undefined, tuning);
  }

  // A selected Fish voice is a promise, not a hint. When the user has chosen
  // one we answer from the Fish path or fail honestly — we never let the free
  // voice speak in its place without saying so.
  if (fishVoiceSelected && !openRouterKey) {
    return NextResponse.json(
      {
        error: "Fish voice selected but no OpenRouter key is available",
        code: "setup_required",
        missing: "openRouterKey",
        requestedVoiceId: openRouterVoiceId,
        hint: OPENROUTER_FISH_SETUP_HINT,
      },
      { status: 503, headers: { "X-TTS-Provider": "openrouter-fish" } },
    );
  }
  if (openRouterIdRejected) {
    return NextResponse.json(
      {
        error: "That voice is a free Edge voice name, not a Fish voice model id",
        code: "invalid_request",
        hint: "Pick a Fish voice in Settings (Voice section) — paste the hex voice model id from OpenRouter, not an Edge Neural name like en-US-AriaNeural.",
      },
      { status: 400 },
    );
  }

  // Keyed attempt helper: 402/429/5xx + network failures fall through to
  // the free path; 401/403/422-class stay honest errors, never masked.
  const tryElevenLabs = async (): Promise<Response | null> => {
    if (!elevenPathActive) return null;
    const outcome = await synthesizeElevenLabs(text, elevenVoiceId, elevenKey as string);
    if (outcome.ok && outcome.audio) {
      return new Response(outcome.audio.buffer as ArrayBuffer, {
        status: 200,
        headers: {
          "Content-Type": outcome.contentType ?? "audio/mpeg",
          "Cache-Control": "public, max-age=3600",
          "X-TTS-Provider": "elevenlabs",
          "X-TTS-Voice": elevenVoiceId,
        },
      });
    }
    if (isFallbackEligible(outcome.status)) {
      return freeAudioResponse(text, freeVoice, fallbackReasonFor(outcome.status), tuning);
    }
    return honestKeyedError("ElevenLabs", outcome.status, outcome.detail);
  };

  const tryAzure = async (): Promise<Response | null> => {
    if (!azurePathActive) return null;
    const outcome = await synthesizeAzureSpeech(
      text,
      freeVoice,
      azureKey as string,
      azureRegion,
      tuning,
    );
    if (outcome.ok && outcome.audio) {
      return new Response(outcome.audio.buffer as ArrayBuffer, {
        status: 200,
        headers: {
          "Content-Type": outcome.contentType ?? "audio/mpeg",
          "Cache-Control": "public, max-age=3600",
          "X-TTS-Provider": "azure",
          "X-TTS-Voice": freeVoice,
        },
      });
    }
    if (isFallbackEligible(outcome.status)) {
      return freeAudioResponse(text, freeVoice, fallbackReasonFor(outcome.status), tuning);
    }
    return honestKeyedError("Azure Speech", outcome.status, outcome.detail);
  };

  const tryOpenRouterFish = async (): Promise<Response | null> => {
    if (!openRouterPathActive) return null;
    const outcome = await synthesizeOpenRouterFish(
      text,
      openRouterVoiceId,
      openRouterKey as string,
      { model: getOpenRouterTtsModel(), format: parsed.data.format ?? "mp3" },
    );
    if (outcome.ok && outcome.audio) {
      return new Response(outcome.audio.buffer as ArrayBuffer, {
        status: 200,
        headers: {
          "Content-Type": outcome.contentType ?? "audio/mpeg",
          "Cache-Control": "public, max-age=3600",
          "X-TTS-Provider": "openrouter-fish",
          "X-TTS-Voice": openRouterVoiceId,
        },
      });
    }
    // 402/429/5xx + network failure (reported as 502) fall through to free.
    if (isFallbackEligible(outcome.status)) {
      return freeAudioResponse(text, freeVoice, fallbackReasonFor(outcome.status), tuning);
    }
    return honestKeyedError("OpenRouter", outcome.status, outcome.detail);
  };

  // Explicit provider: attempt it when configured; a configured explicit
  // provider's honest errors (401/422) return directly, its billable/5xx
  // failures already fell through to free inside the helper.
  if (explicit) {
    if (wants.elevenlabs) {
      const res = await tryElevenLabs();
      if (res) return res;
    } else if (wants.azure) {
      const res = await tryAzure();
      if (res) return res;
    } else if (wants["openrouter-fish"]) {
      // Explicit openrouter-fish with no usable Fish voice id (and no server
      // default): say so instead of quietly speaking the free voice.
      if (!openRouterVoiceId) {
        return NextResponse.json(
          {
            error: "Fish voice selected but no Fish voice model id is set",
            code: "setup_required",
            missing: "fishVoiceId",
            hint: "Pick a Fish voice in Settings (Voice section): paste the voice model id from the OpenRouter playground, or set FISH_AUDIO_VOICE in .env.local.",
          },
          { status: 503, headers: { "X-TTS-Provider": "openrouter-fish" } },
        );
      }
      const res = await tryOpenRouterFish();
      if (res) return res;
    } else if (wants.fish) {
      if (fishPathActive) {
        // Fall through to the Fish attempt below.
      } else {
        // Explicit Fish without key/voice cannot synthesize — fall through
        // to the automatic priority (free path answers, never 503s).
      }
    }
    // Explicit but unconfigured (or Fish): continue to automatic priority.
  }

  // Automatic priority: Fish key+ref → ElevenLabs key+voice →
  // Azure key+region → free Edge path.
  if (!explicit || wants.fish) {
    if (fishPathActive) {
      const audioFormat = parsed.data.format ?? "mp3";
      let fishRes: Response;
      try {
        fishRes = await fetch(FISH_AUDIO_API_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            ...(FISH_AUDIO_MODEL ? { model: FISH_AUDIO_MODEL } : {}),
          },
          body: JSON.stringify({
            text,
            reference_id: referenceId,
            format: audioFormat,
          }),
        });
      } catch (err) {
        // Fish unreachable -> automatic free fallback (always true now).
        console.error("Fish Audio TTS network failure:", err);
        return freeAudioResponse(text, freeVoice, "provider_error", tuning);
      }

      if (!fishRes.ok) {
        const fishStatus = fishRes.status;
        // Automatic free fallback: 402 (billing) / 429 / 5xx only. 401 (bad key)
        // and 422 (no voice) stay honest errors and never fall back.
        if (isFallbackEligible(fishStatus)) {
          try {
            await fishRes.arrayBuffer();
          } catch {
            /* error body is advisory only — fallback proceeds regardless */
          }
          return freeAudioResponse(text, freeVoice, fallbackReasonFor(fishStatus), tuning);
        }
        return fishErrorResponse(fishStatus, fishRes);
      }

      const contentType = fishRes.headers.get("content-type") ?? "";
      if (!contentType.startsWith("audio/")) {
        console.error(
          "Fish Audio returned non-audio success body with content-type:",
          contentType,
        );
        return NextResponse.json(
          {
            error: "Fish Audio returned an unexpected response",
            code: "provider_error",
            hint: "Retry shortly; if it persists, check the Fish Audio status page.",
          },
          { status: 502 },
        );
      }

      const audioBuffer = await fishRes.arrayBuffer();
      return new Response(audioBuffer, {
        status: 200,
        headers: {
          "Content-Type": audioFormat === "wav" ? "audio/wav" : "audio/mpeg",
          "Cache-Control": "public, max-age=3600",
          "X-TTS-Provider": "fish-audio",
          "X-TTS-Voice": referenceId,
        },
      });
    }
  }

  // Automatic priority: Fish key+ref → ElevenLabs key+voice →
  // Azure key+region → OpenRouter key + Fish voice id → free Edge path.
  if (!explicit || wants.elevenlabs || wants.fish || wants["openrouter-fish"]) {
    const elevenRes = await tryElevenLabs();
    if (elevenRes) return elevenRes;
  }
  if (!explicit || wants.azure || wants.fish || wants["openrouter-fish"]) {
    const azureRes = await tryAzure();
    if (azureRes) return azureRes;
  }
  if (!explicit || wants.fish || wants["openrouter-fish"]) {
    const openRouterRes = await tryOpenRouterFish();
    if (openRouterRes) return openRouterRes;
  }

  return freeAudioResponse(text, freeVoice, undefined, tuning);
}

