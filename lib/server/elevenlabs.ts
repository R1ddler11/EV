/* PROJECT E.V. — ElevenLabs TTS, server-only optional provider (key-gated).
   Free tier: https://elevenlabs.io (~10k chars/month). Never required; the
   route falls through to the free Edge path when no key/voice is configured.
   Endpoint shape per https://elevenlabs.io/docs/api-reference/text-to-speech :
     POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}
     headers: `xi-api-key: <key>`, `Content-Type: application/json`
     body: { text, model_id, voice_settings: { stability, similarity_boost, style } } */

import { ELEVENLABS_MODEL_ID, ELEVENLABS_TTS_URL } from "@/lib/config/voice";

export interface KeyedProviderOutcome {
  ok: boolean;
  status: number;
  audio: Uint8Array | null;
  contentType: string | null;
  detail: string;
}

/** Cap advisory error bodies so binary payloads are never buffered. */
async function readDetail(res: Response): Promise<string> {
  try {
    const text = await res.text();
    if (!text) return "";
    try {
      const parsed = JSON.parse(text) as { message?: unknown; detail?: unknown };
      const msg =
        typeof parsed.message === "string"
          ? parsed.message
          : typeof parsed.detail === "string"
            ? parsed.detail
            : "";
      if (msg) return msg.slice(0, 300);
    } catch {
      /* not JSON — fall through to raw slice */
    }
    return text.slice(0, 300);
  } catch {
    return "";
  }
}

/**
 * Synthesize `text` with an ElevenLabs voice_id. Never throws for HTTP
 * errors — returns { ok: false, status } so the route can fall back to the
 * free path (402/429/5xx) or answer honestly (401/422/...).
 */
export async function synthesizeElevenLabs(
  text: string,
  voiceId: string,
  apiKey: string,
): Promise<KeyedProviderOutcome> {
  let res: Response;
  try {
    res = await fetch(
      `${ELEVENLABS_TTS_URL}/${encodeURIComponent(voiceId)}`,
      {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        body: JSON.stringify({
          text,
          model_id: ELEVENLABS_MODEL_ID,
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
            style: 0.5,
          },
        }),
      },
    );
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
