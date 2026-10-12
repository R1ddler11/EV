/* PROJECT E.V. — Azure Speech TTS, server-only optional provider (key-gated).
   Free tier F0: https://azure.microsoft.com (500k chars/month free). Never
   required; the route falls through to the free Edge path when no
   key/region is configured. Same Neural voice pool as Edge, official quota.
   Endpoint shape per
   https://learn.microsoft.com/azure/ai-services/speech-service/rest-text-to-speech :
     POST https://{region}.tts.speech.microsoft.com/cognitiveservices/v1
     headers: `Ocp-Apim-Subscription-Key: <key>`,
              `Content-Type: application/ssml+xml`,
              `X-Microsoft-OutputFormat: audio-24khz-48kbitrate-mono-mp3`
     body: SSML <speak> with a Neural voice Name. */

import { EDGE_STYLE_ALLOWLIST, type EdgeTtsTuning } from "@/lib/server/edge-tts";
import type { KeyedProviderOutcome } from "@/lib/server/elevenlabs";

const AZURE_OUTPUT_FORMAT = "audio-24khz-48kbitrate-mono-mp3";

const INCOMPATIBLE_CHARS = new RegExp(
  "[" + "\\x00-\\x08" + "\\x0B\\x0C" + "\\x0E-\\x1F" + "]",
  "g",
);

function sanitizePct(value: string | null | undefined, fallback: string): string {
  const match = /^\s*([+-]?)(\d{1,3})\s*%\s*$/.exec(value ?? "");
  if (!match) return fallback;
  const sign = match[1] === "-" ? "-" : "+";
  const amount = Math.min(50, Math.max(0, Number.parseInt(match[2] ?? "0", 10)));
  return `${sign}${amount}%`;
}

function buildAzureSsml(text: string, voice: string, tuning?: EdgeTtsTuning): string {
  const escaped = text
    .replace(INCOMPATIBLE_CHARS, " ")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const rate = sanitizePct(tuning?.ratePct, "+0%");
  const pitch = sanitizePct(tuning?.pitchPct, "+0%");
  const rawStyle = tuning?.style?.trim().toLowerCase() ?? "";
  const style = (EDGE_STYLE_ALLOWLIST as readonly string[]).includes(rawStyle)
    ? rawStyle
    : null;
  const degree =
    typeof tuning?.styleDegree === "number" && Number.isFinite(tuning.styleDegree)
      ? Math.min(2, Math.max(0, tuning.styleDegree))
      : 1;
  const prosody = `<prosody rate="${rate}" pitch="${pitch}">${escaped}</prosody>`;
  const inner = style
    ? `<mstts:express-as style="${style}" styledegree="${degree}">${prosody}</mstts:express-as>`
    : prosody;
  return (
    "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' " +
    "xmlns:mstts='http://www.w3.org/2001/mstts' xml:lang='en-US'>" +
    `<voice name='${voice}'>${inner}</voice></speak>`
  );
}

async function readDetail(res: Response): Promise<string> {
  try {
    const text = await res.text();
    return text ? text.slice(0, 300) : "";
  } catch {
    return "";
  }
}

/**
 * Synthesize `text` with an Azure Neural voice. Never throws for HTTP
 * errors — returns { ok: false, status } so the route can fall back to the
 * free path (402/429/5xx) or answer honestly (401/400/...).
 */
export async function synthesizeAzureSpeech(
  text: string,
  voice: string,
  key: string,
  region: string,
  tuning?: EdgeTtsTuning,
): Promise<KeyedProviderOutcome> {
  let res: Response;
  try {
    res = await fetch(
      `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`,
      {
        method: "POST",
        headers: {
          "Ocp-Apim-Subscription-Key": key,
          "Content-Type": "application/ssml+xml",
          "X-Microsoft-OutputFormat": AZURE_OUTPUT_FORMAT,
        },
        body: buildAzureSsml(text, voice, tuning),
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
  const contentType = res.headers.get("content-type") ?? "audio/mpeg";
  return {
    ok: true,
    status: 200,
    audio: new Uint8Array(await res.arrayBuffer()),
    contentType,
    detail: "",
  };
}
