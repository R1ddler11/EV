/* PROJECT E.V. — Fish-quality TTS via OpenRouter, server-only (key-gated).
   Uses the OpenRouter key the owner ALREADY has — no Fish Audio key needed.
   Endpoint shape verified 2026-10-12 against
   https://openrouter.ai/docs/features/multimodal/tts and
   https://openrouter.ai/docs/api/api-reference/tts/create-audio-speech :
     POST https://openrouter.ai/api/v1/audio/speech
     headers: `Authorization: Bearer <OPENROUTER_API_KEY>`,
       `Content-Type: application/json`, HTTP-Referer + X-Title (same as chat).
     body (JSON): { model, input, voice, response_format }
       - `model` defaults to fish-audio/s2.1-pro-free:free (env OPENROUTER_TTS_MODEL).
       - `voice` is a Fish voice MODEL ID (hex id, NOT a Neural voice Name).
     success: a raw audio bytestream (NOT JSON).
   In-endpoint fallback: when /audio/speech answers 404/422 (shape unknown
   for this model), retry once as a chat/completions audio-modality request
   ({ model, modalities: ["text","audio"], audio: { voice, format },
     messages: [{ role: "user", content }] }) and base64-decode
   choices[0].message.audio.data.
   Never throws for HTTP errors — returns { ok: false, status } so the route
   can fall through to the free path (402/429/5xx + network failure) or
   answer honestly (401/422/...). Error bodies are capped at ~2KB and keys
   are never echoed. */

import { OPENROUTER_BASE_URL, OPENROUTER_DEFAULT_HEADERS } from "@/lib/config/models";
import { OPENROUTER_FISH_MODEL_DEFAULT } from "@/lib/config/voice";
import type { KeyedProviderOutcome } from "./elevenlabs";

/** Cap advisory error bodies so a binary body is never buffered into an error. */
const ERROR_BODY_CAP = 2048;

/** Cap advisory error bodies so binary payloads are never buffered. */
async function readDetail(res: Response): Promise<string> {
  try {
    const text = await res.text();
    if (!text) return "";
    const capped = text.slice(0, ERROR_BODY_CAP);
    try {
      const parsed: unknown = JSON.parse(capped);
      if (parsed && typeof parsed === "object") {
        if ("message" in parsed && typeof parsed.message === "string" && parsed.message.length > 0) {
          return parsed.message.slice(0, 300);
        }
        if ("error" in parsed) {
          const err: unknown = parsed.error;
          if (typeof err === "string" && err.length > 0) return err.slice(0, 300);
          if (
            err !== null &&
            typeof err === "object" &&
            "message" in err &&
            typeof err.message === "string" &&
            err.message.length > 0
          ) {
            return err.message.slice(0, 300);
          }
        }
      }
    } catch {
      /* not JSON — fall through to raw slice */
    }
    return capped.slice(0, 300);
  } catch {
    return "";
  }
}

/**
 * Synthesize `text` with a Fish voice model id hosted on OpenRouter.
 * `voiceId` MUST be a Fish voice model id — callers exclude Neural Names.
 * Never throws for HTTP errors; network failure reports as 502 so the route
 * falls through to the free path.
 */
export async function synthesizeOpenRouterFish(
  text: string,
  voiceId: string,
  apiKey: string,
  opts?: { model?: string; format?: "mp3" | "wav" },
): Promise<KeyedProviderOutcome> {
  const model = opts?.model?.trim() || OPENROUTER_FISH_MODEL_DEFAULT;
  const format = opts?.format === "wav" ? "wav" : "mp3";

  // Primary shape: OpenAI-compatible audio/speech (matches the Playground
  // contract { model, input, voice, response_format } -> raw MP3 bytes).
  let res: Response;
  try {
    res = await fetch(`${OPENROUTER_BASE_URL}/audio/speech`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...OPENROUTER_DEFAULT_HEADERS,
      },
      body: JSON.stringify({ model, input: text, voice: voiceId, response_format: format }),
    });
  } catch (err) {
    return {
      ok: false,
      status: 502,
      audio: null,
      contentType: null,
      detail: err instanceof Error ? err.message.slice(0, 300) : "network failure",
    };
  }

  if (res.ok) {
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.startsWith("audio/")) {
      return {
        ok: false,
        status: 502,
        audio: null,
        contentType: null,
        detail: `unexpected content-type: ${contentType.slice(0, 100)}`,
      };
    }
    return {
      ok: true,
      status: 200,
      audio: new Uint8Array(await res.arrayBuffer()),
      contentType,
      detail: "",
    };
  }

  // 401 (bad key) stays honest immediately — retrying another shape cannot
  // fix auth and must never mask it. 404/422 fall through to the chat shape.
  if (res.status === 404 || res.status === 422) {
    return synthesizeViaChatCompletions(text, voiceId, apiKey, model, format);
  }
  return {
    ok: false,
    status: res.status,
    audio: null,
    contentType: null,
    detail: await readDetail(res),
  };
}

/**
 * Second shape: chat/completions with audio modality. Returns the
 * base64-decoded audio bytes, or the chat endpoint's own honest error.
 */
async function synthesizeViaChatCompletions(
  text: string,
  voiceId: string,
  apiKey: string,
  model: string,
  format: "mp3" | "wav",
): Promise<KeyedProviderOutcome> {
  let res: Response;
  try {
    res = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...OPENROUTER_DEFAULT_HEADERS,
      },
      body: JSON.stringify({
        model,
        modalities: ["text", "audio"],
        audio: { voice: voiceId, format },
        messages: [{ role: "user", content: text }],
      }),
    });
  } catch (err) {
    return {
      ok: false,
      status: 502,
      audio: null,
      contentType: null,
      detail: err instanceof Error ? err.message.slice(0, 300) : "network failure",
    };
  }
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      audio: null,
      contentType: null,
      detail: await readDetail(res),
    };
  }
  let data = "";
  try {
    const json: unknown = await res.json();
    if (json && typeof json === "object" && "choices" in json && Array.isArray(json.choices)) {
      const first: unknown = json.choices[0];
      if (first && typeof first === "object" && "message" in first) {
        const message: unknown = first.message;
        if (message && typeof message === "object" && "audio" in message) {
          const audioPart: unknown = message.audio;
          if (
            audioPart &&
            typeof audioPart === "object" &&
            "data" in audioPart &&
            typeof audioPart.data === "string"
          ) {
            data = audioPart.data;
          }
        }
      }
    }
  } catch {
    data = "";
  }
  // Buffer.from skips non-base64 chars instead of throwing, so an invalid
  // payload decodes short/empty and is rejected by the length check below.
  const audio = new Uint8Array(Buffer.from(data, "base64"));
  if (audio.length === 0) {
    return {
      ok: false,
      status: 502,
      audio: null,
      contentType: null,
      detail: "chat audio response carried no usable audio data",
    };
  }
  return {
    ok: true,
    status: 200,
    audio,
    contentType: format === "wav" ? "audio/wav" : "audio/mpeg",
    detail: "",
  };
}
