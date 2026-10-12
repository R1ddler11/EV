/* PROJECT E.V. — Microsoft Edge Read Aloud TTS, server-only free provider.
   No API key. Protocol ported from rany2/edge-tts (MIT License):
     https://github.com/rany2/edge-tts
   Endpoint shape (verified live 2026-10-12 — plain HTTPS POST returns 404;
   the endpoint only speaks WebSocket):
     wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1
       ?TrustedClientToken=6A5AA1D4EAFF4E9FB37E23D68491D6F4
       &ConnectionId=<32-hex-chars>
       &Sec-MS-GEC=<token>&Sec-MS-GEC-Version=1-<chromium-full-version>
     handshake headers: Origin chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold,
       Edge User-Agent, Pragma/Cache-Control no-cache, Cookie muid=<32-HEX>.
   Token ("Sec-MS-GEC"): uppercased ASCII-SHA256 hex of
     "<windows-filetime-now-rounded-down-to-5min><trusted-client-token>".
   The token is a pure function of the 5-minute time quantum, so it is cached
   in module memory and recomputed only when the quantum rolls over (caching
   it longer would send expired tokens).
   Frames after open: (1) a speech.config JSON text frame, (2) an ssml text
   frame ("X-RequestId / Content-Type:application/ssml+xml / X-Timestamp /
   Path:ssml" headers + SSML envelope). Audio arrives as binary frames: the
   first 2 bytes (big-endian) are the header length, then the header block,
   then raw MP3 bytes (output format audio-24khz-48kbitrate-mono-mp3). A
   "Path:turn.end" text frame ends the stream; binary frames with an empty
   payload are terminal padding, not audio.
   SSML voice expansion ("en-US-AriaNeural" ->
   "Microsoft Server Speech Text to Speech Voice (en-US, AriaNeural)") plus
   the text hygiene below mirror edge-tts mkssml/remove_incompatible_characters.
   Node 22+ provides a global WebSocket (undici) that accepts per-request
   headers; runtimes without it throw here and the caller falls through to
   the Google Translate proxy. */

import { createHash, randomBytes } from "node:crypto";

import {
  EDGE_TTS_OUTPUT_FORMAT,
  EDGE_TTS_SEC_MS_GEC_VERSION,
  EDGE_TTS_TRUSTED_CLIENT_TOKEN,
  EDGE_TTS_WSS_URL,
} from "@/lib/config/voice";

const WIN_EPOCH_SECONDS = 11644473600;
const EDGE_ORIGIN = "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold";
const EDGE_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0";
/** Per-connection budget: Edge usually answers within a few seconds. */
const EDGE_TIMEOUT_MS = 30_000;
/** Long route texts are split so each connection carries a bounded SSML body. */
const EDGE_CHUNK_CHARS = 3000;

export interface EdgeTtsResult {
  audio: Uint8Array;
  voice: string;
  contentType: "audio/mpeg";
}

/* Token cache: keyed by the 5-minute quantum the token is derived from. */
let cachedToken = "";
let cachedQuantum = -1;

/* Matches the control ranges edge-tts strips (keeps tab/newline/CR). */
const INCOMPATIBLE_CHARS = new RegExp(
  "[" + "\\x00-\\x08" + "\\x0B\\x0C" + "\\x0E-\\x1F" + "]",
  "g",
);

/**
 * Build (or reuse) the Sec-MS-GEC token. Recomputed only when the 5-minute
 * quantum rolls over; the value intentionally uses float arithmetic identical
 * to edge-tts drm.py (verified against the live handshake).
 */
export function getSecMsGecToken(nowMs = Date.now()): string {
  const quantum = Math.floor((nowMs / 1000 + WIN_EPOCH_SECONDS) / 300);
  if (cachedToken && quantum === cachedQuantum) return cachedToken;
  let ticks = nowMs / 1000 + WIN_EPOCH_SECONDS;
  ticks -= ticks % 300;
  ticks *= 1e9 / 100;
  const token = createHash("sha256")
    .update(`${ticks.toFixed(0)}${EDGE_TTS_TRUSTED_CLIENT_TOKEN}`, "ascii")
    .digest("hex")
    .toUpperCase();
  cachedToken = token;
  cachedQuantum = quantum;
  return token;
}

/** "Mon Oct 12 2026 12:00:00 GMT+0000 (Coordinated Universal Time)" (UTC). */
function edgeDateString(now = new Date()): string {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const pad = (n: number): string => String(n).padStart(2, "0");
  const day = days[now.getUTCDay()] ?? "Mon";
  const month = months[now.getUTCMonth()] ?? "Jan";
  return (
    `${day} ${month} ${pad(now.getUTCDate())} ${now.getUTCFullYear()} ` +
    `${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}:${pad(now.getUTCSeconds())} ` +
    "GMT+0000 (Coordinated Universal Time)"
  );
}

/**
 * Expand a short voice Name to the full form Edge expects. Mirrors
 * TTSConfig.__post_init__ in edge-tts (including the multilingual dash rule).
 */
export function expandEdgeVoiceName(voice: string): string {
  const trimmed = voice.trim();
  const match = /^([a-z]{2,})-([A-Z]{2,})-(.+Neural)$/.exec(trimmed);
  if (!match) return trimmed;
  const lang = match[1] ?? "";
  const region = match[2] ?? "";
  const rest = match[3] ?? "";
  const dash = rest.indexOf("-");
  const fullRegion = dash === -1 ? region : `${region}-${rest.slice(0, dash)}`;
  const name = dash === -1 ? rest : rest.slice(dash + 1);
  return (
    "Microsoft Server Speech Text to Speech Voice " +
    `(${lang}-${fullRegion}, ${name})`
  );
}

/** Expressive style names accepted on the free Edge path (Luna supports these). */
export const EDGE_STYLE_ALLOWLIST = ["cheerful", "friendly", "excited", "hopeful", "gentle"] as const;
export type EdgeTtsStyle = (typeof EDGE_STYLE_ALLOWLIST)[number];

/** Optional expressive tuning for the free Edge SSML envelope. */
export interface EdgeTtsTuning {
  style?: string | null;
  styleDegree?: number | null;
  ratePct?: string | null;
  pitchPct?: string | null;
}

function isEdgeStyle(value: string): value is EdgeTtsStyle {
  return (EDGE_STYLE_ALLOWLIST as readonly string[]).includes(value);
}

/** Sanitize a "+8%"-style percent; invalid input falls back to `fallback`. Clamped to ±50%. */
function sanitizePct(value: string | null | undefined, fallback: string): string {
  const match = /^\s*([+-]?)(\d{1,3})\s*%\s*$/.exec(value ?? "");
  if (!match) return fallback;
  const sign = match[1] === "-" ? "-" : "+";
  const amount = Math.min(50, Math.max(0, Number.parseInt(match[2] ?? "0", 10)));
  return `${sign}${amount}%`;
}

function sanitizeDegree(value: number | null | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(2, Math.max(0, Math.round(value * 100) / 100));
}

function buildSsml(text: string, voice: string, tuning?: EdgeTtsTuning): string {
  // Control characters the service rejects become spaces; the text node is
  // XML-escaped so the SSML envelope stays well-formed.
  const escaped = text
    .replace(INCOMPATIBLE_CHARS, " ")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const rate = sanitizePct(tuning?.ratePct, "+0%");
  const pitch = sanitizePct(tuning?.pitchPct, "+0%");
  const rawStyle = tuning?.style?.trim().toLowerCase() ?? "";
  const style = isEdgeStyle(rawStyle) ? rawStyle : null;
  const degree = sanitizeDegree(tuning?.styleDegree, 1);
  const prosody = `<prosody pitch='${pitch}' rate='${rate}' volume='+0%'>${escaped}</prosody>`;
  const inner = style
    ? `<mstts:express-as style="${style}" styledegree="${degree}">${prosody}</mstts:express-as>`
    : prosody;
  return (
    "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xmlns:mstts='http://www.w3.org/2001/mstts' xml:lang='en-US'>" +
    `<voice name='${expandEdgeVoiceName(voice)}'>` +
    `${inner}</voice></speak>`
  );
}

/** Word-boundary split so each WS connection carries a bounded SSML body. */
function chunkText(text: string): string[] {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return [];
  const chunks: string[] = [];
  let rest = cleaned;
  while (rest.length > 0) {
    if (rest.length <= EDGE_CHUNK_CHARS) {
      chunks.push(rest);
      break;
    }
    let cut = rest.lastIndexOf(" ", EDGE_CHUNK_CHARS);
    if (cut < 400) cut = EDGE_CHUNK_CHARS;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut).trimStart();
  }
  return chunks.slice(0, 4);
}

export type EdgeWebSocketCtor = new (
  url: string,
  options?: { headers?: Record<string, string> },
) => WebSocket;

function isWebSocketCtor(value: unknown): value is EdgeWebSocketCtor {
  return typeof value === "function";
}

function openEdgeSocket(url: string): WebSocket {
  const holder: { WebSocket?: unknown } = globalThis as {
    WebSocket?: unknown;
  };
  const ctor = holder.WebSocket;
  if (!isWebSocketCtor(ctor)) {
    throw new Error("WebSocket unavailable in this runtime");
  }
  return new ctor(url, {
    headers: {
      Origin: EDGE_ORIGIN,
      "User-Agent": EDGE_USER_AGENT,
      Pragma: "no-cache",
      "Cache-Control": "no-cache",
      Cookie: `muid=${randomBytes(16).toString("hex").toUpperCase()};`,
    },
  });
}

function isBlobLike(
  value: unknown,
): value is { arrayBuffer: () => Promise<ArrayBuffer> } {
  return (
    typeof value === "object" &&
    value !== null &&
    "arrayBuffer" in value &&
    typeof value.arrayBuffer === "function"
  );
}

async function coerceBinary(data: unknown): Promise<Buffer | null> {
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(data)) return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  if (typeof ArrayBuffer !== "undefined" && ArrayBuffer.isView(data)) {
    const view = data as unknown as {
      buffer: unknown;
      byteOffset: number;
      byteLength: number;
    };
    if (view.buffer instanceof ArrayBuffer) {
      return Buffer.from(view.buffer, view.byteOffset, view.byteLength);
    }
  }
  // Undici (Next.js runtime) delivers binary WS frames as Blob.
  if (isBlobLike(data)) return Buffer.from(await data.arrayBuffer());
  return null;
}

/** Extract the MP3 payload from one binary frame; null for padding/other. */
function extractAudio(frame: Buffer): Buffer | null {
  if (frame.length < 2) return null;
  const headerLength = frame.readUInt16BE(0);
  if (headerLength > frame.length) return null;
  const header = frame.subarray(2, headerLength).toString("utf8");
  if (!header.includes("Path:audio")) return null;
  const payload = frame.subarray(headerLength + 2);
  return payload.length > 0 ? Buffer.from(payload) : null;
}

/** One SSML body over one WS connection; resolves with its MP3 parts. */
async function synthesizeChunk(ssmlText: string): Promise<Buffer[]> {
  const connectionId = randomBytes(16).toString("hex");
  const url =
    `${EDGE_TTS_WSS_URL}&ConnectionId=${connectionId}` +
    `&Sec-MS-GEC=${getSecMsGecToken()}` +
    `&Sec-MS-GEC-Version=${EDGE_TTS_SEC_MS_GEC_VERSION}`;
  const ws = openEdgeSocket(url);

  const date = edgeDateString();
  const configFrame =
    `X-Timestamp:${date}\r\n` +
    "Content-Type:application/json; charset=utf-8\r\n" +
    "Path:speech.config\r\n\r\n" +
    `{"context":{"synthesis":{"audio":{"metadataoptions":{` +
    `"sentenceBoundaryEnabled":"true","wordBoundaryEnabled":"false"},` +
    `"outputFormat":"${EDGE_TTS_OUTPUT_FORMAT}"}}}}\r\n`;
  const ssmlFrame =
    `X-RequestId:${connectionId}\r\n` +
    "Content-Type:application/ssml+xml\r\n" +
    `X-Timestamp:${date}Z\r\n` + // Trailing Z mirrors edge-tts (upstream quirk).
    "Path:ssml\r\n\r\n" +
    ssmlText;

  return await new Promise<Buffer[]>((resolve, reject) => {
    const binaries: Buffer[] = [];
    let settled = false;
    // Binary frames arrive as Blobs (async arrayBuffer()); turn.end may land
    // first, so finishing waits for in-flight conversions to settle.
    let pending = 0;
    let turnEnded = false;
    const timer = setTimeout(() => {
      finish(new Error("Edge TTS timed out waiting for audio"));
    }, EDGE_TIMEOUT_MS);
    const finish = (err: Error | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        /* already closed */
      }
      if (err) {
        reject(err);
        return;
      }
      const audioParts: Buffer[] = [];
      for (const frame of binaries) {
        const audio = extractAudio(frame);
        if (audio) audioParts.push(audio);
      }
      if (audioParts.length === 0) {
        reject(new Error("Edge TTS returned no audio (check voice name)"));
        return;
      }
      resolve(audioParts);
    };
    ws.addEventListener("open", () => {
      try {
        ws.send(configFrame);
        ws.send(ssmlFrame);
      } catch (sendError) {
        finish(
          sendError instanceof Error
            ? sendError
            : new Error("Edge TTS send failed"),
        );
      }
    });
    ws.addEventListener("message", (event: MessageEvent) => {
      const incoming: unknown = event.data;
      if (typeof incoming === "string") {
        if (incoming.includes("Path:turn.end")) {
          if (pending === 0) finish(null);
          else turnEnded = true;
        }
        return;
      }
      pending += 1;
      void coerceBinary(incoming).then((bin) => {
        pending -= 1;
        if (!settled && bin) binaries.push(bin);
        if (turnEnded && pending === 0 && !settled) finish(null);
      });
    });
    ws.addEventListener("error", () => {
      finish(new Error("Edge TTS websocket error (endpoint unreachable?)"));
    });
    ws.addEventListener("close", () => {
      finish(new Error("Edge TTS connection closed before turn.end"));
    });
  });
}

/**
 * Synthesize `text` with the free Edge voice `voice` (a Neural voice Name).
 * Throws when the runtime has no WebSocket, the handshake fails, or no audio
 * arrives — callers fall through to the translate proxy.
 */
export async function synthesizeEdgeTts(
  text: string,
  voice: string,
  tuning?: EdgeTtsTuning,
): Promise<EdgeTtsResult> {
  const chunks = chunkText(text);
  if (chunks.length === 0) throw new Error("Edge TTS received no text");
  const parts: Buffer[] = [];
  for (const chunk of chunks) {
    const audioParts = await synthesizeChunk(buildSsml(chunk, voice, tuning));
    parts.push(...audioParts);
  }
  return { audio: Buffer.concat(parts), voice, contentType: "audio/mpeg" };
}
