/* PROJECT E.V. — shared domain types (frontend-owned).
   Backend contracts for /api/chat and /api/voice/session live in lib/api.ts. */

export type CoreState =
  | "idle"
  | "connecting"
  | "listening"
  | "processing"
  | "speaking"
  | "interrupted"
  | "disconnected"
  | "error";

export type CloudStatus = "untested" | "reachable" | "unreachable";

/** Conversation register for POST /api/chat. "daily" keeps replies ordinary-life
 * and free of sysadmin chatter; "builder" welcomes system and tool detail. */
export type ChatMode = "daily" | "builder";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: number;
}

export interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

export interface Note {
  id: string;
  title: string;
  body: string;
  createdAt: number;
  updatedAt: number;
}

export interface MemoryItem {
  id: string;
  text: string;
  /** Only user-approved text ever becomes a memory. */
  source: "user-approved" | "conversation-pin";
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

/** Which path produced a voice recording: "realtime" = E.V.'s
 * remote audio track from the live link; "local-tts" = E.V.'s
 * spoken replies captured from the text-to-speech fallback.
 * The user's own microphone is never recorded. */
export type RecordingSource = "realtime" | "local-tts";

/** A saved voice recording of E.V.'s voice. The blob lives in
 * IndexedDB; sizeBytes is shown in the UI so the storage cost
 * stays visible. */
export interface Recording {
  id: string;
  title: string;
  source: RecordingSource;
  createdAt: number;
  durationSec: number;
  /** Exact container the audio was written with, persisted so
   * playback uses the same mimeType the file was encoded with. */
  mimeType: string;
  sizeBytes: number;
  blob: Blob;
}

/** A named Fish Audio premium voice slot: `referenceId` is the Fish voice model ID sent as `reference_id`. Persisted; never wiped by free-voice changes. */
export interface FishVoicePreset {
  slot: string;
  name: string;
  desc: string;
  referenceId: string;
}

/** Voice provider group the owner selected. "free" = Edge Neural voices (no
 * key). "openrouter-fish" = a Fish voice model id through the OpenRouter key. */
export type VoiceSource = "free" | "openrouter-fish";

export interface AppSettings {
  memoryEnabled: boolean;
  transcriptPersistence: boolean;
  reducedMotionOverride: "system" | "reduce" | "full";
  openRouterApiKey?: string;
  openRouterModel?: string;
  /** Voice ID used for TTS: a free Edge voice ID (e.g. en-US-AriaNeural), a Fish reference_id when premium is configured, or "" for the server free default. */
  ttsVoice?: string;
  /** Fish Audio API key (optional premium), stored in browser IndexedDB only. Never logged. Absent/blank = free voices. */
  fishAudioApiKey?: string;
  /** Fish voice model id used through OpenRouter (provider "openrouter-fish", free S2.1 Pro Free model). Uses the OpenRouter key — no Fish key needed. Persisted; blank = unset. */
  fishVoiceViaOpenRouter?: string;
  /** Authoritative ACTIVE voice group. "free" speaks with `ttsVoice` (Edge
   * Neural, no key); "openrouter-fish" speaks with `fishVoiceViaOpenRouter`
   * through the OpenRouter key. Persisted; default "free". */
  activeVoiceSource?: VoiceSource;
  /** Saved Fish voice model ids offered by the voice chooser. The active one
   * is `fishVoiceViaOpenRouter`; the rest stay for one-click switching. */
  fishVoices?: string[];
  /** Editable Fish voice preset slots (Settings -> Voice -> Premium). Persisted premium config; untouched by free-voice changes. */
  fishVoicePresets?: FishVoicePreset[];
  /** ElevenLabs API key (optional), stored in browser IndexedDB only. Never logged. Absent/blank = free voices. */
  elevenLabsApiKey?: string;
  /** ElevenLabs default voice_id (optional). Used only with an ElevenLabs key; blank = unset. */
  elevenLabsVoiceId?: string;
  /** Azure Speech key (optional), stored in browser IndexedDB only. Never logged. Absent/blank = free voices. */
  azureSpeechKey?: string;
  /** Azure Speech region (optional, e.g. southeastasia). Used only with an Azure key. */
  azureSpeechRegion?: string;
  wakeWordEnabled?: boolean;
  /** Chat register sent with every /api/chat request. Persisted; default "daily". */
  chatMode?: ChatMode;
  /** Speak assistant replies aloud in the text chat via browser speech synthesis. Persisted; default off. */
  speakReplies?: boolean;
  /** speechSynthesis voice URI for the text chat (not the voice-page TTS voices). Persisted; blank = platform default. */
  speakVoice?: string;
}

export const DEFAULT_SETTINGS: AppSettings = {
  memoryEnabled: true,
  transcriptPersistence: true,
  reducedMotionOverride: "system",
  openRouterApiKey: "",
  openRouterModel: "anthropic/claude-3.5-sonnet",
  ttsVoice: "",
  fishAudioApiKey: "",
  fishVoiceViaOpenRouter: "",
  activeVoiceSource: "free",
  fishVoices: [],
  elevenLabsApiKey: "",
  elevenLabsVoiceId: "",
  azureSpeechKey: "",
  azureSpeechRegion: "",
  wakeWordEnabled: false,
  chatMode: "daily",
  speakReplies: false,
  speakVoice: "",
};

export interface ActivityEntry {
  id: string;
  kind: "chat" | "voice" | "note" | "memory" | "diagnostic" | "system";
  label: string;
  detail?: string;
  at: number;
}

export type DiagnosticStatus = "nominal" | "degraded" | "standby";

export interface DiagnosticResult {
  key: string;
  label: string;
  status: DiagnosticStatus;
  value: string;
  detail: string;
  /** Always true for now: this panel is a deterministic simulation. */
  simulated: true;
}

export function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.floor(
    Math.random() * 0xffff,
  ).toString(36)}`;
}
