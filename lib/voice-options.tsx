/* PROJECT E.V. — shared voice-option helpers (frontend-owned).
   The voice chooser's pure logic: the preset model list, the
   free Edge voices, the Fish-via-OpenRouter premium slots, the
   ACTIVE-voice resolver, speakText options, and the single
   "ACTIVE" badge. Used by the settings page and the voice page
   (moved out of the retired settings modal, which was also a
   library for these symbols). */
import { Check } from "lucide-react";
import type { FC } from "react";
import type { SpeakTextOptions } from "@/lib/api";
import { isLegacyVoiceId } from "@/lib/config/voice";
import type { AppSettings, VoiceSource } from "@/lib/types";

export const PRESET_MODELS = [
  {
    id: "anthropic/claude-3.5-sonnet",
    name: "Claude 3.5 Sonnet",
    badge: "Recommended",
    provider: "Anthropic",
  },
  {
    id: "openai/gpt-4o",
    name: "GPT-4o",
    badge: "Flagship",
    provider: "OpenAI",
  },
  {
    id: "openai/gpt-4o-mini",
    name: "GPT-4o Mini",
    badge: "Fast & Light",
    provider: "OpenAI",
  },
  {
    id: "google/gemini-2.0-flash-exp:free",
    name: "Gemini 2.0 Flash",
    badge: "Free Tier",
    provider: "Google",
  },
  {
    id: "meta-llama/llama-3.3-70b-instruct",
    name: "Llama 3.3 70B",
    badge: "Open Weights",
    provider: "Meta",
  },
  {
    id: "deepseek/deepseek-chat",
    name: "DeepSeek Chat",
    badge: "V3",
    provider: "DeepSeek",
  },
] as const;

/** Fish Audio premium slots (collapsed "Premium (optional)" subsection).
 * A slot holds a Fish voice-model `reference_id` (editable below);
 * selecting a slot speaks with its reference_id. Persisted per browser. */
export const VOICE_OPTIONS = [
  { id: "primary", name: "Primary", desc: "Everyday E.V. voice" },
  { id: "secondary", name: "Secondary", desc: "Alternate voice" },
  { id: "narrator", name: "Narrator", desc: "Reading / long-form voice" },
] as const;

/** Free Edge voices (no key needed). `id` is the exact voice ID sent to
 * /api/voice/tts — human `name` never leaves the UI. Empty ttsVoice ("Auto")
 * means "server free default". */
export const FREE_VOICE_OPTIONS = [
  { id: "en-SG-LunaNeural", name: "Hanni (inspired)", desc: "SG female · bright youthful · free" },
  { id: "en-US-AriaNeural", name: "Aria", desc: "US female · free" },
  { id: "en-US-JennyNeural", name: "Jenny", desc: "US female · free" },
  { id: "en-US-GuyNeural", name: "Guy", desc: "US male · free" },
  { id: "en-GB-SoniaNeural", name: "Sonia", desc: "UK female · free" },
  { id: "en-GB-RyanNeural", name: "Ryan", desc: "UK male · free" },
] as const;

/** The voice E.V. currently speaks with: which group is ACTIVE plus the exact
 * id sent to /api/voice/tts. `activeVoiceSource` is the persisted selector;
 * `ttsVoice` holds the free Edge id, `fishVoiceViaOpenRouter` the Fish model id. */
export interface ActiveVoice {
  source: VoiceSource;
  /** "free": Edge Neural id, "" = server free default. "openrouter-fish": Fish model id. */
  id: string;
}

/** Saved Fish voice ids for the chooser: the persisted list plus the active one
 * (so a voice saved before this list existed is never invisible). */
export function savedFishVoices(
  settings: Pick<AppSettings, "fishVoices" | "fishVoiceViaOpenRouter">,
): string[] {
  const list = settings.fishVoices ?? [];
  const active = (settings.fishVoiceViaOpenRouter ?? "").trim();
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of active ? [active, ...list] : list) {
    const trimmed = id.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

/** Resolve the persisted ACTIVE voice. A Fish source without a stored id falls
 * back to free, so the two groups can never both look selected. */
export function resolveActiveVoice(
  settings: Pick<AppSettings, "activeVoiceSource" | "ttsVoice" | "fishVoiceViaOpenRouter">,
): ActiveVoice {
  const fishId = (settings.fishVoiceViaOpenRouter ?? "").trim();
  if ((settings.activeVoiceSource ?? "free") === "openrouter-fish" && fishId) {
    return { source: "openrouter-fish", id: fishId };
  }
  const freeId = (settings.ttsVoice ?? "").trim();
  return { source: "free", id: isLegacyVoiceId(freeId) ? "" : freeId };
}

/** speakText options for a chosen voice. A free id sends the Neural voice id on
 * the free path (no key); a Fish id sends provider "openrouter-fish" with
 * fishVoiceId and the OpenRouter key when one is set. */
export function speakOptionsForVoice(
  voice: ActiveVoice,
  settings: Pick<AppSettings, "openRouterApiKey">,
): SpeakTextOptions {
  if (voice.source === "openrouter-fish") {
    const openRouterKey = (settings.openRouterApiKey ?? "").trim();
    return {
      provider: "openrouter-fish",
      ...(openRouterKey ? { openRouterKey } : {}),
      fishVoiceId: voice.id,
    };
  }
  return voice.id ? { voice: voice.id } : {};
}

/** Human provider name from the X-TTS-Provider response header. */
export function describeTtsProvider(provider: string | null): string {
  switch (provider) {
    case "fish-audio": return "Fish Audio (premium)";
    case "openrouter-fish": return "Fish via OpenRouter (free)";
    case "elevenlabs": return "ElevenLabs";
    case "azure": return "Azure Speech";
    case "edge-tts": return "Edge TTS (free)";
    case "fallback-translate": return "Translate fallback (free)";
    default: return provider ? `${provider} (free)` : "free voice";
  }
}

/** Short label for a saved Fish voice: its position in the chooser. */
export function fishVoiceLabel(index: number): string {
  return `Fish voice ${index + 1}`;
}

/** Middle-truncate a long model id so both ends stay readable. */
export function truncateId(id: string, max = 18): string {
  if (id.length <= max) return id;
  const head = Math.ceil((max - 1) / 2);
  return `${id.slice(0, head)}…${id.slice(-(max - head - 1))}`;
}

/** The single, unambiguous "this is the voice in use" marker. Rendered on the
 * active card in BOTH the free and the Fish-via-OpenRouter group. */
export const ActiveBadge: FC = () => (
  <span
    style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 4,
      fontSize: 10,
      fontWeight: 700,
      letterSpacing: "0.08em",
      color: "#051318",
      background: "#35e0ff",
      borderRadius: 9999,
      padding: "1px 7px",
      whiteSpace: "nowrap",
    }}
  >
    <Check style={{ width: 10, height: 10 }} /> ACTIVE
  </span>
);
