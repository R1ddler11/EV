"use client";

import { useEffect, useRef, useState, type FC } from "react";
import { Eye, EyeOff, Key, Sparkles, X, Check, Trash2, Cpu, Volume2, Mic, Plus } from "lucide-react";
import { useEv } from "@/lib/store";
import { SectionLabel, StatusPill } from "./ui";
import { BackendUnavailableError, speakText, type SpeakTextOptions } from "@/lib/api";
import {
  DEFAULT_FISH_VOICE_PRESETS,
  isLegacyVoiceId,
} from "@/lib/config/voice";
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

export interface SettingsModalProps {
  open?: boolean;
  onClose?: () => void;
}

export const SettingsModal: FC<SettingsModalProps> = ({
  open: propOpen,
  onClose: propOnClose,
}) => {
  const {
    settings,
    settingsOpen,
    closeSettings,
    backendConfigured,
    setOpenRouterApiKey,
    setOpenRouterModel,
    setTtsVoice,
    setFishAudioApiKey,
    setFishVoiceViaOpenRouter,
    setActiveVoiceSource,
    setFishVoices,
    setFishVoicePresets,
    setElevenLabsApiKey,
    setElevenLabsVoiceId,
    setAzureSpeechKey,
    setAzureSpeechRegion,
    setWakeWordEnabled,
    recordActivity,
  } = useEv();

  const isOpen = propOpen !== undefined ? propOpen : settingsOpen;
  const handleClose = propOnClose ?? closeSettings;

  const [prevOpen, setPrevOpen] = useState(false);
  const [prevApiKey, setPrevApiKey] = useState(settings.openRouterApiKey);
  const [keyInput, setKeyInput] = useState(settings.openRouterApiKey ?? "");
  const [showKey, setShowKey] = useState(false);
  const [prevFishKey, setPrevFishKey] = useState(settings.fishAudioApiKey);
  const [fishKeyInput, setFishKeyInput] = useState(settings.fishAudioApiKey ?? "");
  const [showFishKey, setShowFishKey] = useState(false);
  const [prevFishOrVoiceId, setPrevFishOrVoiceId] = useState(settings.fishVoiceViaOpenRouter);
  const [newFishVoiceInput, setNewFishVoiceInput] = useState("");
  const [showPremium, setShowPremium] = useState(false);
  const [elevenKeyInput, setElevenKeyInput] = useState(settings.elevenLabsApiKey ?? "");
  const [elevenVoiceInput, setElevenVoiceInput] = useState(settings.elevenLabsVoiceId ?? "");
  const [showElevenKey, setShowElevenKey] = useState(false);
  const [azureKeyInput, setAzureKeyInput] = useState(settings.azureSpeechKey ?? "");
  const [azureRegionInput, setAzureRegionInput] = useState(settings.azureSpeechRegion ?? "");
  const [showAzureKey, setShowAzureKey] = useState(false);
  const [customModelInput, setCustomModelInput] = useState("");
  const [customVoiceInput, setCustomVoiceInput] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [previewingVoice, setPreviewingVoice] = useState(false);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);

  // Sync internal input state when dialog opens or stored settings change during render
  const [prevElevenKey, setPrevElevenKey] = useState(settings.elevenLabsApiKey);
  const [prevElevenVoice, setPrevElevenVoice] = useState(settings.elevenLabsVoiceId);
  const [prevAzureKey, setPrevAzureKey] = useState(settings.azureSpeechKey);
  const [prevAzureRegion, setPrevAzureRegion] = useState(settings.azureSpeechRegion);
  if (
    isOpen &&
    (!prevOpen ||
      settings.openRouterApiKey !== prevApiKey ||
      settings.fishAudioApiKey !== prevFishKey ||
      settings.fishVoiceViaOpenRouter !== prevFishOrVoiceId ||
      settings.elevenLabsApiKey !== prevElevenKey ||
      settings.elevenLabsVoiceId !== prevElevenVoice ||
      settings.azureSpeechKey !== prevAzureKey ||
      settings.azureSpeechRegion !== prevAzureRegion)
  ) {
    setPrevOpen(isOpen);
    setPrevApiKey(settings.openRouterApiKey);
    setKeyInput(settings.openRouterApiKey ?? "");
    setPrevFishKey(settings.fishAudioApiKey);
    setFishKeyInput(settings.fishAudioApiKey ?? "");
    setPrevFishOrVoiceId(settings.fishVoiceViaOpenRouter);
    setNewFishVoiceInput("");
    setPrevElevenKey(settings.elevenLabsApiKey);
    setElevenKeyInput(settings.elevenLabsApiKey ?? "");
    setPrevElevenVoice(settings.elevenLabsVoiceId);
    setElevenVoiceInput(settings.elevenLabsVoiceId ?? "");
    setPrevAzureKey(settings.azureSpeechKey);
    setAzureKeyInput(settings.azureSpeechKey ?? "");
    setPrevAzureRegion(settings.azureSpeechRegion);
    setAzureRegionInput(settings.azureSpeechRegion ?? "");
    setCustomModelInput("");
    setFeedback(null);
  } else if (!isOpen && prevOpen) {
    setPrevOpen(false);
  }

  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Handle escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        handleClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, handleClose]);
  useEffect(() => {
    return () => {
      if (previewAudioRef.current) {
        previewAudioRef.current.pause();
        previewAudioRef.current = null;
      }
    };
  }, []);

  if (!isOpen) return null;

  const currentKey = (settings.openRouterApiKey ?? "").trim();
  const currentModel = settings.openRouterModel || "anthropic/claude-3.5-sonnet";

  // Derive key status: UI key vs server key vs none
  let keyStatus: { label: string; tone: "ok" | "warn" | "mute" };
  if (currentKey) {
    keyStatus = { label: "Key set in UI", tone: "ok" };
  } else if (backendConfigured) {
    keyStatus = { label: "Using server .env key", tone: "ok" };
  } else {
    keyStatus = { label: "No key set", tone: "warn" };
  }

  const handleSaveKey = async () => {
    const trimmed = keyInput.trim();
    await setOpenRouterApiKey(trimmed);
    await recordActivity(
      "system",
      trimmed ? "OpenRouter API key saved to browser" : "OpenRouter API key cleared",
    );
    setFeedback(trimmed ? "Key saved successfully" : "Key cleared");
    setTimeout(() => setFeedback(null), 2500);
  };

  const handleClearKey = async () => {
    setKeyInput("");
    await setOpenRouterApiKey("");
    await recordActivity("system", "OpenRouter API key cleared");
    setFeedback("Key cleared");
    setTimeout(() => setFeedback(null), 2500);
  };

  const handleSelectModel = async (modelId: string) => {
    await setOpenRouterModel(modelId);
    await recordActivity("system", `Active model switched to ${modelId}`);
    setFeedback(`Model set to ${modelId}`);
    setTimeout(() => setFeedback(null), 2000);
  };

  const handleSetCustomModel = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = customModelInput.trim();
    if (!trimmed) return;
    await setOpenRouterModel(trimmed);
    await recordActivity("system", `Active model set to custom: ${trimmed}`);
    setCustomModelInput("");
    setFeedback(`Model set to ${trimmed}`);
    setTimeout(() => setFeedback(null), 2000);
  };
  // Voice selection. Free Edge voice IDs (or no selection = server free
  // default) speak with no key; Fish premium reference_ids speak with the
  // stored Fish key. The selected ID is what speakText sends — display
  // names never leave the UI.
  const voicePresets = settings.fishVoicePresets ?? DEFAULT_FISH_VOICE_PRESETS;
  const selectedVoice = (settings.ttsVoice ?? "").trim();
  const selectedPresetSlot =
    voicePresets.find((p) => p.referenceId.trim() === selectedVoice)?.slot ??
    null;
  const legacyStoredVoice = isLegacyVoiceId(selectedVoice);
  const fishKey = (settings.fishAudioApiKey ?? "").trim();
  const openRouterKey = (settings.openRouterApiKey ?? "").trim();
  const elevenKey = (settings.elevenLabsApiKey ?? "").trim();
  const azureKey = (settings.azureSpeechKey ?? "").trim();

  const handleSaveFishKey = async () => {
    const trimmed = fishKeyInput.trim();
    await setFishAudioApiKey(trimmed);
    await recordActivity(
      "system",
      trimmed ? "Fish Audio API key saved to browser" : "Fish Audio API key cleared",
    );
    setFeedback(trimmed ? "Fish Audio key saved successfully" : "Fish Audio key cleared");
    setTimeout(() => setFeedback(null), 2500);
  };

  const activeVoice = resolveActiveVoice(settings);
  const fishVoiceList = savedFishVoices(settings);
  const fishActive = activeVoice.source === "openrouter-fish";

  const handleSelectFreeVoice = async (voiceId: string, label: string) => {
    const trimmed = voiceId.trim();
    await setTtsVoice(trimmed);
    await setActiveVoiceSource("free");
    await recordActivity(
      "voice",
      trimmed
        ? `Voice switched to ${label} (${trimmed})`
        : "Voice switched to Auto (server free default)",
    );
    setFeedback(trimmed ? `Voice set to ${label}` : "Voice set to Auto — free by default");
    setTimeout(() => setFeedback(null), 2000);
  };

  const handleSelectFishVoice = async (id: string, label: string) => {
    const trimmed = id.trim();
    if (!trimmed) return;
    await setFishVoiceViaOpenRouter(trimmed);
    await setActiveVoiceSource("openrouter-fish");
    await recordActivity("voice", `Voice switched to ${label} (Fish via OpenRouter, ${trimmed})`);
    setFeedback(`E.V. now speaks with ${label} — Fish via OpenRouter`);
    setTimeout(() => setFeedback(null), 2500);
  };

  const handleAddFishVoice = async () => {
    const trimmed = newFishVoiceInput.trim();
    if (!trimmed) return;
    const existing = fishVoiceList.find((id) => id.toLowerCase() === trimmed.toLowerCase());
    if (existing) {
      setNewFishVoiceInput("");
      await handleSelectFishVoice(existing, fishVoiceLabel(fishVoiceList.indexOf(existing)));
      return;
    }
    await setFishVoices([...fishVoiceList, trimmed]);
    setNewFishVoiceInput("");
    await handleSelectFishVoice(trimmed, fishVoiceLabel(fishVoiceList.length));
  };

  const handleRemoveFishVoice = async (id: string) => {
    const trimmed = id.trim();
    const remaining = fishVoiceList.filter((v) => v !== trimmed);
    await setFishVoices(remaining);
    if (trimmed === activeVoice.id) {
      await setFishVoiceViaOpenRouter(remaining[0] ?? "");
      await setActiveVoiceSource(remaining.length > 0 ? "openrouter-fish" : "free");
    }
    await recordActivity("voice", `Fish voice ${truncateId(trimmed)} removed`);
    setFeedback(
      remaining.length > 0
        ? `Fish voice ${truncateId(trimmed)} removed`
        : "Fish voice removed — E.V. is back on a free voice",
    );
    setTimeout(() => setFeedback(null), 2500);
  };

  const handleClearFishKey = async () => {
    setFishKeyInput("");
    await setFishAudioApiKey("");
    await recordActivity("system", "Fish Audio API key cleared");
    setFeedback("Fish Audio key cleared");
    setTimeout(() => setFeedback(null), 2500);
  };

  const handleSaveElevenKey = async () => {
    const trimmed = elevenKeyInput.trim();
    await setElevenLabsApiKey(trimmed);
    await recordActivity(
      "system",
      trimmed ? "ElevenLabs API key saved to browser" : "ElevenLabs API key cleared",
    );
    setFeedback(trimmed ? "ElevenLabs key saved successfully" : "ElevenLabs key cleared");
    setTimeout(() => setFeedback(null), 2500);
  };

  const handleClearElevenKey = async () => {
    setElevenKeyInput("");
    await setElevenLabsApiKey("");
    await recordActivity("system", "ElevenLabs API key cleared");
    setFeedback("ElevenLabs key cleared");
    setTimeout(() => setFeedback(null), 2500);
  };

  const handleSaveElevenVoice = async () => {
    const trimmed = elevenVoiceInput.trim();
    await setElevenLabsVoiceId(trimmed);
    await recordActivity(
      "voice",
      trimmed ? `ElevenLabs voice set to ${trimmed}` : "ElevenLabs voice cleared",
    );
    setFeedback(trimmed ? `ElevenLabs voice set to ${trimmed}` : "ElevenLabs voice cleared");
    setTimeout(() => setFeedback(null), 2500);
  };

  const handleSaveAzureKey = async () => {
    const trimmed = azureKeyInput.trim();
    await setAzureSpeechKey(trimmed);
    await recordActivity(
      "system",
      trimmed ? "Azure Speech key saved to browser" : "Azure Speech key cleared",
    );
    setFeedback(trimmed ? "Azure Speech key saved successfully" : "Azure Speech key cleared");
    setTimeout(() => setFeedback(null), 2500);
  };

  const handleClearAzureKey = async () => {
    setAzureKeyInput("");
    await setAzureSpeechKey("");
    await recordActivity("system", "Azure Speech key cleared");
    setFeedback("Azure Speech key cleared");
    setTimeout(() => setFeedback(null), 2500);
  };

  const handleSaveAzureRegion = async () => {
    const trimmed = azureRegionInput.trim();
    await setAzureSpeechRegion(trimmed);
    await recordActivity(
      "voice",
      trimmed ? `Azure Speech region set to ${trimmed}` : "Azure Speech region cleared",
    );
    setFeedback(trimmed ? `Azure Speech region set to ${trimmed}` : "Azure Speech region cleared");
    setTimeout(() => setFeedback(null), 2500);
  };

  const handleSelectVoice = async (voiceId: string, label: string) => {
    const trimmed = voiceId.trim();
    await setTtsVoice(trimmed);
    await recordActivity("voice", trimmed ? `Voice switched to ${label} (${trimmed})` : `Voice switched to Auto (server free default)`);
    setFeedback(trimmed ? `Voice set to ${label}` : "Voice set to Auto — free by default");
    setTimeout(() => setFeedback(null), 2000);
  };

  const handleSavePresetId = async (e: React.FormEvent<HTMLFormElement>, slot: string) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const raw = String(data.get("referenceId") ?? "").trim();
    const next = voicePresets.map((p) =>
      p.slot === slot ? { ...p, referenceId: raw } : p,
    );
    await setFishVoicePresets(next);
    if (raw && selectedPresetSlot === slot) {
      await setTtsVoice(raw);
    }
    await recordActivity(
      "voice",
      raw ? `Voice slot ${slot} set to ${raw}` : `Voice slot ${slot} cleared`,
    );
    setFeedback(raw ? `Voice slot ${slot} saved` : `Voice slot ${slot} cleared`);
    setTimeout(() => setFeedback(null), 2000);
  };

  const handleSetCustomVoice = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = customVoiceInput.trim();
    if (!trimmed) return;
    await setTtsVoice(trimmed);
    await recordActivity("voice", `Voice set to custom reference_id ${trimmed}`);
    setCustomVoiceInput("");
    setFeedback(`Voice set to ${trimmed}`);
    setTimeout(() => setFeedback(null), 2000);
  };

  // Preview speaks the voice it is handed: a free card previews its Neural id on
  // the free path, a Fish card previews that model id through provider
  // "openrouter-fish". Feedback names the voice and the provider the server
  // actually used, read from the response headers.
  const handlePreviewVoice = async (target?: ActiveVoice) => {
    if (previewingVoice) {
      if (previewAudioRef.current) {
        previewAudioRef.current.pause();
        previewAudioRef.current = null;
      }
      setPreviewingVoice(false);
      return;
    }
    const voice = target ?? activeVoice;
    try {
      setPreviewingVoice(true);
      setFeedback(null);
      const { blob, voice: spokenVoice, provider } = await speakText(
        "Greetings, Alfarez. E.V. audio systems nominal.",
        { ...speakOptionsForVoice(voice, settings), allowFallback: true },
      );
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      previewAudioRef.current = audio;
      audio.onended = () => {
        setPreviewingVoice(false);
        previewAudioRef.current = null;
      };
      audio.onerror = () => {
        setPreviewingVoice(false);
        previewAudioRef.current = null;
      };
      await audio.play();
      // Stay honest about which voice actually spoke (headers from the server).
      const spoken = spokenVoice ?? voice.id ?? null;
      const prettyProvider = describeTtsProvider(provider);
      const requested = voice.source === "openrouter-fish" ? "Fish via OpenRouter" : "free voice";
      setFeedback(
        spoken
          ? `Previewed ${spoken} via ${prettyProvider} (requested ${requested}).`
          : `Previewed via ${prettyProvider} (requested ${requested}).`,
      );
    } catch (err) {
      console.error("Voice preview failed:", err);
      setPreviewingVoice(false);
      const code = err instanceof BackendUnavailableError ? err.code : undefined;
      if (
        (code === "invalid_credentials" || code === "setup_required") &&
        voice.source === "openrouter-fish"
      ) {
        setFeedback(
          "Fish via OpenRouter was rejected — check your OpenRouter key. No Fish Audio key is needed for this voice; nothing was spoken.",
        );
      } else if (code === "rate_limited" && voice.source === "openrouter-fish") {
        setFeedback(
          "The free Fish model on OpenRouter is rate-limited — wait ~30s and preview again. Nothing was spoken.",
        );
      } else if ((code === "billing_required" || code === "payment_required") && (fishKey || elevenKey || azureKey)) {
        setFeedback(
          "Premium voice is out of credits — retry in a moment, or clear the voice key to use free voices.",
        );
      } else {
        setFeedback(
          err instanceof BackendUnavailableError
            ? `${err.message} ${err.hint} Nothing was spoken — retry in a moment.`
            : "Failed to preview voice — retry in a moment.",
        );
      }
      setTimeout(() => setFeedback(null), 6000);
    }
  };


  return (
    <div
      className="ev-confirm-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-dialog-title"
      onClick={handleClose}
      style={{ zIndex: 100 }}
    >
      <div
        ref={dialogRef}
        className="ev-confirm"
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: 640,
          width: "92vw",
          maxHeight: "90vh",
          overflowY: "auto",
          padding: 24,
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 20,
            borderBottom: "1px solid var(--color-ev-line)",
            paddingBottom: 14,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Cpu style={{ color: "#35e0ff", width: 20, height: 20 }} />
            <div>
              <h2
                id="settings-dialog-title"
                style={{
                  fontSize: 17,
                  fontWeight: 650,
                  margin: 0,
                  color: "var(--color-ev-ink)",
                }}
              >
                Model & Intelligence Settings
              </h2>
              <p
                style={{
                  fontSize: 12,
                  color: "var(--color-ev-muted)",
                  margin: 0,
                  marginTop: 2,
                }}
              >
                Configure OpenRouter provider credentials and active model
              </p>
            </div>
          </div>
          <button
            type="button"
            className="ev-icon-btn"
            onClick={handleClose}
            aria-label="Close settings"
            style={{ padding: 6 }}
          >
            <X style={{ width: 16, height: 16 }} />
          </button>
        </div>

        {/* Section 1: OpenRouter API Key */}
        <section style={{ marginBottom: 26 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 8,
            }}
          >
            <label
              htmlFor="openrouter-key-input"
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "var(--color-ev-ink)",
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <Key style={{ width: 14, height: 14, color: "#35e0ff" }} />
              OpenRouter API Key
            </label>
            <StatusPill tone={keyStatus.tone}>{keyStatus.label}</StatusPill>
          </div>

          <p
            style={{
              fontSize: 12,
              color: "var(--color-ev-muted)",
              marginBottom: 10,
              lineHeight: 1.5,
            }}
          >
            Keys entered here stay strictly in your browser&apos;s IndexedDB and
            are forwarded with chat requests. When left blank, E.V. utilizes the
            server-configured environment key.
          </p>

          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <div style={{ position: "relative", flex: 1 }}>
              <input
                ref={inputRef}
                id="openrouter-key-input"
                type={showKey ? "text" : "password"}
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                placeholder={
                  backendConfigured
                    ? "Leave blank to use server environment key..."
                    : "sk-or-v1-..."
                }
                className="ev-input"
                style={{
                  paddingRight: 38,
                  fontFamily: "var(--font-geist-mono), monospace",
                  fontSize: 12.5,
                }}
              />
              <button
                type="button"
                onClick={() => setShowKey((v) => !v)}
                aria-label={showKey ? "Hide API key" : "Show API key"}
                style={{
                  position: "absolute",
                  right: 8,
                  top: "50%",
                  transform: "translateY(-50%)",
                  background: "transparent",
                  border: "none",
                  color: "var(--color-ev-muted)",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  padding: 4,
                }}
              >
                {showKey ? (
                  <EyeOff style={{ width: 15, height: 15 }} />
                ) : (
                  <Eye style={{ width: 15, height: 15 }} />
                )}
              </button>
            </div>

            <button
              type="button"
              className="ev-btn ev-btn-primary ev-btn-sm"
              onClick={() => void handleSaveKey()}
            >
              Save Key
            </button>

            {currentKey && (
              <button
                type="button"
                className="ev-btn ev-btn-ghost ev-btn-sm"
                onClick={() => void handleClearKey()}
                title="Clear browser API key"
                style={{ color: "#ff857a" }}
              >
                <Trash2 style={{ width: 14, height: 14 }} /> Clear
              </button>
            )}
          </div>
        </section>

        {/* Section 2: Model Selector */}
        <section style={{ marginBottom: 20 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 8,
            }}
          >
            <span
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "var(--color-ev-ink)",
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <Sparkles style={{ width: 14, height: 14, color: "#35e0ff" }} />
              Active Model Selection
            </span>
            <span
              style={{
                fontSize: 11.5,
                fontFamily: "var(--font-geist-mono), monospace",
                color: "#35e0ff",
                background: "rgba(53, 224, 255, 0.08)",
                padding: "2px 8px",
                borderRadius: 4,
                border: "1px solid rgba(53, 224, 255, 0.2)",
              }}
            >
              {currentModel}
            </span>
          </div>

          <p
            style={{
              fontSize: 12,
              color: "var(--color-ev-muted)",
              marginBottom: 12,
              lineHeight: 1.5,
            }}
          >
            Select from popular OpenRouter models or specify any custom model ID.
          </p>

          {/* Quick select preset buttons */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
              gap: 8,
              marginBottom: 14,
            }}
          >
            {PRESET_MODELS.map((m) => {
              const isSelected = currentModel === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => void handleSelectModel(m.id)}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "flex-start",
                    gap: 3,
                    padding: "10px 12px",
                    borderRadius: 8,
                    border: isSelected
                      ? "1px solid #35e0ff"
                      : "1px solid var(--color-ev-line)",
                    background: isSelected
                      ? "rgba(18, 51, 61, 0.55)"
                      : "#0e1318",
                    color: isSelected ? "#c9f3ff" : "var(--color-ev-ink)",
                    cursor: "pointer",
                    textAlign: "left",
                    transition: "border-color 0.15s, background 0.15s",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      width: "100%",
                    }}
                  >
                    <span style={{ fontSize: 13, fontWeight: 600 }}>
                      {m.name}
                    </span>
                    {isSelected && (
                      <Check style={{ width: 13, height: 13, color: "#35e0ff" }} />
                    )}
                  </div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      fontSize: 11,
                      color: isSelected ? "#9ee7f5" : "var(--color-ev-muted)",
                    }}
                  >
                    <span>{m.provider}</span>
                    <span>·</span>
                    <span>{m.badge}</span>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Custom model input */}
          <form
            onSubmit={(e) => void handleSetCustomModel(e)}
            style={{ display: "flex", gap: 8, alignItems: "center" }}
          >
            <input
              type="text"
              value={customModelInput}
              onChange={(e) => setCustomModelInput(e.target.value)}
              placeholder="Or type custom model ID (e.g. mistralai/mistral-large)..."
              className="ev-input"
              style={{
                fontSize: 12.5,
                fontFamily: "var(--font-geist-mono), monospace",
              }}
            />
            <button
              type="submit"
              disabled={!customModelInput.trim()}
              className="ev-btn ev-btn-sm"
              style={{ whiteSpace: "nowrap" }}
            >
              Use Custom
            </button>
          </form>
        </section>

        {/* Voice chooser — the ACTIVE voice is what E.V. speaks with */}
        <section
          style={{
            marginBottom: 22,
            paddingBottom: 20,
            borderBottom: "1px solid var(--color-ev-line)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 8,
              gap: 8,
              flexWrap: "wrap",
            }}
          >
            <span
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "var(--color-ev-ink)",
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <Volume2 style={{ width: 14, height: 14, color: "#35e0ff" }} />
              Choose your E.V. voice
            </span>
            <button
              type="button"
              onClick={() => void handlePreviewVoice()}
              className="ev-btn ev-btn-sm"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                fontSize: 12,
              }}
            >
              <Volume2 style={{ width: 13, height: 13 }} />
              {previewingVoice ? "Stop Preview" : "Preview active voice"}
            </button>
          </div>

          <p
            style={{
              fontSize: 12,
              color: "var(--color-ev-muted)",
              marginBottom: 12,
              lineHeight: 1.5,
            }}
          >
            The voice badged{" "}
            <strong style={{ color: "#35e0ff" }}>ACTIVE</strong> is the one E.V.
            speaks with — here and on the Voice page. Click any voice to make it
            active; Preview always speaks the voice it sits on.
          </p>

          {legacyStoredVoice && (
            <div
              className="ev-banner"
              role="status"
              style={{ marginBottom: 12, padding: "8px 12px", fontSize: 12.5 }}
            >
              <span>
                Stored voice &quot;{selectedVoice}&quot; is a legacy OpenAI voice
                name — E.V. speaks the free default instead. Pick a free voice
                below to save a new active voice.
              </span>
            </div>
          )}

          {/* FREE VOICES — no key required */}
          <div style={{ marginBottom: 14 }}>
            <SectionLabel>FREE VOICES · no key needed</SectionLabel>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))",
                gap: 8,
              }}
            >
              {[
                { id: "", name: "Auto (Free)", desc: "Server default · no setup" },
                ...FREE_VOICE_OPTIONS.map((v) => ({ id: v.id, name: v.name, desc: v.desc })),
              ].map((v) => {
                const isActive = activeVoice.source === "free" && activeVoice.id === v.id;
                return (
                  <div
                    key={v.id || "auto"}
                    style={{
                      borderRadius: 8,
                      border: isActive
                        ? "1px solid #35e0ff"
                        : "1px solid var(--color-ev-line)",
                      background: isActive ? "rgba(18, 51, 61, 0.55)" : "#0e1318",
                      overflow: "hidden",
                    }}
                  >
                    <button
                      type="button"
                      aria-pressed={isActive}
                      onClick={() => void handleSelectFreeVoice(v.id, v.name)}
                      title={
                        v.id
                          ? `${v.id} (free — no key needed)`
                          : "Server free default voice — no setup needed"
                      }
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "flex-start",
                        gap: 3,
                        width: "100%",
                        padding: "9px 12px",
                        background: "transparent",
                        border: "none",
                        color: isActive ? "#c9f3ff" : "var(--color-ev-ink)",
                        cursor: "pointer",
                        textAlign: "left",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          width: "100%",
                          gap: 6,
                        }}
                      >
                        <span style={{ fontSize: 13, fontWeight: 600 }}>{v.name}</span>
                        {isActive && <ActiveBadge />}
                      </div>
                      <span
                        style={{
                          fontSize: 11,
                          color: isActive ? "#9ee7f5" : "var(--color-ev-muted)",
                        }}
                      >
                        {v.desc}
                      </span>
                      <span
                        style={{
                          fontSize: 10.5,
                          fontFamily: "var(--font-geist-mono), monospace",
                          color: isActive ? "#9ee7f5" : "var(--color-ev-muted)",
                          wordBreak: "break-all",
                        }}
                      >
                        {v.id || "server default"}
                      </span>
                    </button>
                    <div
                      style={{
                        borderTop: "1px solid var(--color-ev-line)",
                        padding: "5px 12px",
                      }}
                    >
                      <button
                        type="button"
                        className="ev-btn ev-btn-ghost ev-btn-sm"
                        onClick={() => void handlePreviewVoice({ source: "free", id: v.id })}
                        style={{ fontSize: 11, padding: "2px 0" }}
                      >
                        <Volume2 style={{ width: 12, height: 12 }} /> Preview
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* FISH VIA OPENROUTER — free model, needs the OpenRouter key */}
          <div
            style={{
              marginBottom: 8,
              border: "1px solid var(--color-ev-line)",
              borderRadius: 8,
              padding: "10px 12px 12px",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 8,
                gap: 8,
                flexWrap: "wrap",
              }}
            >
              <SectionLabel>FISH VIA OPENROUTER · free model, needs your OpenRouter key</SectionLabel>
              <StatusPill tone={openRouterKey ? "ok" : "warn"}>
                {openRouterKey ? "OpenRouter key set" : "No OpenRouter key"}
              </StatusPill>
            </div>
            <p
              style={{
                fontSize: 12,
                color: "var(--color-ev-muted)",
                marginBottom: 12,
                lineHeight: 1.5,
              }}
            >
              Fish-quality voices through the free S2.1 Pro Free model on
              OpenRouter — no Fish key or credits needed. Paste a Fish voice model
              id (the hex id from the OpenRouter playground) and add it; then click
              it to make it the active voice. The OpenRouter key above is reused.
            </p>

            {/* Add-a-voice: always the first control in this group */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void handleAddFishVoice();
              }}
              style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}
            >
              <input
                id="fish-openrouter-voice-input"
                type="text"
                value={newFishVoiceInput}
                onChange={(e) => setNewFishVoiceInput(e.target.value)}
                placeholder="Fish voice model id — paste the hex id from the OpenRouter playground"
                aria-label="Fish voice model id to add"
                className="ev-input"
                autoComplete="off"
                spellCheck={false}
                style={{
                  fontSize: 12.5,
                  fontFamily: "var(--font-geist-mono), monospace",
                }}
              />
              <button
                type="submit"
                disabled={!newFishVoiceInput.trim()}
                className="ev-btn ev-btn-primary ev-btn-sm"
                style={{ whiteSpace: "nowrap" }}
              >
                <Plus style={{ width: 13, height: 13 }} /> Add voice
              </button>
            </form>

            {fishVoiceList.length === 0 ? (
              <p
                role="status"
                style={{
                  fontSize: 12,
                  color: "var(--color-ev-muted)",
                  lineHeight: 1.5,
                  margin: 0,
                }}
              >
                No Fish voices saved yet. To add one: open the OpenRouter
                playground, copy a Fish voice model id (the hex id), paste it above
                and press Add voice.
              </p>
            ) : (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
                  gap: 8,
                }}
              >
                {fishVoiceList.map((id, index) => {
                  const isActive = fishActive && activeVoice.id === id;
                  const label = fishVoiceLabel(index);
                  return (
                    <div
                      key={id}
                      style={{
                        borderRadius: 8,
                        border: isActive
                          ? "1px solid #35e0ff"
                          : "1px solid var(--color-ev-line)",
                        background: isActive ? "rgba(18, 51, 61, 0.55)" : "#0e1318",
                        overflow: "hidden",
                      }}
                    >
                      <button
                        type="button"
                        aria-pressed={isActive}
                        onClick={() => void handleSelectFishVoice(id, label)}
                        title={`${label}: ${id} — click to make it the active E.V. voice`}
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "flex-start",
                          gap: 3,
                          width: "100%",
                          padding: "9px 12px",
                          background: "transparent",
                          border: "none",
                          color: isActive ? "#c9f3ff" : "var(--color-ev-ink)",
                          cursor: "pointer",
                          textAlign: "left",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            width: "100%",
                            gap: 6,
                          }}
                        >
                          <span style={{ fontSize: 13, fontWeight: 600 }}>{label}</span>
                          {isActive && <ActiveBadge />}
                        </div>
                        <span
                          title={id}
                          style={{
                            fontSize: 10.5,
                            fontFamily: "var(--font-geist-mono), monospace",
                            color: isActive ? "#9ee7f5" : "var(--color-ev-muted)",
                            maxWidth: "100%",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {truncateId(id)}
                        </span>
                      </button>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          borderTop: "1px solid var(--color-ev-line)",
                          padding: "4px 12px",
                        }}
                      >
                        <button
                          type="button"
                          className="ev-btn ev-btn-ghost ev-btn-sm"
                          onClick={() =>
                            void handlePreviewVoice({ source: "openrouter-fish", id })
                          }
                          style={{ fontSize: 11, padding: "2px 0" }}
                        >
                          <Volume2 style={{ width: 12, height: 12 }} /> Preview
                        </button>
                        <button
                          type="button"
                          className="ev-btn ev-btn-ghost ev-btn-sm"
                          onClick={() => void handleRemoveFishVoice(id)}
                          title={`Delete ${label}`}
                          aria-label={`Delete ${label}`}
                          style={{ color: "#ff857a", padding: "2px 4px" }}
                        >
                          <Trash2 style={{ width: 13, height: 13 }} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Premium (optional): Fish Audio — collapsed, still functional */}
          <div
            style={{
              marginTop: 4,
              border: "1px solid var(--color-ev-line)",
              borderRadius: 8,
              overflow: "hidden",
            }}
          >
            <button
              type="button"
              onClick={() => setShowPremium((v) => !v)}
              aria-expanded={showPremium}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "10px 12px",
                background: "transparent",
                border: "none",
                cursor: "pointer",
                color: "var(--color-ev-ink)",
                fontSize: 12.5,
                fontWeight: 600,
              }}
            >
              <span>Premium (optional){fishKey || elevenKey || azureKey ? " · key saved" : ""}</span>
              <span style={{ color: "var(--color-ev-muted)", fontSize: 12 }}>
                {showPremium ? "▾ Hide" : "▸ Show"}
              </span>
            </button>
            {showPremium && (
              <div style={{ padding: "0 12px 12px" }}>
                <p
                  style={{
                    fontSize: 12,
                    color: "var(--color-ev-muted)",
                    marginBottom: 12,
                    lineHeight: 1.5,
                  }}
                >
                  Optional premium voices: Fish Audio (https://fish.audio), ElevenLabs
                  (https://elevenlabs.io), and Azure Speech. Paste an optional key below
                  with its voice/region — keys are never required. Free voices
                  above always work.
                </p>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: 8,
                  }}
                >
                  <label
                    htmlFor="fish-key-input"
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: "var(--color-ev-ink)",
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    <Key style={{ width: 14, height: 14, color: "#35e0ff" }} />
                    Fish Audio API Key
                  </label>
                  <StatusPill tone={fishKey ? "ok" : "mute"}>
                    {fishKey ? "Key set in UI" : "Optional — not set"}
                  </StatusPill>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 16 }}>
                  <div style={{ position: "relative", flex: 1 }}>
                    <input
                      id="fish-key-input"
                      type={showFishKey ? "text" : "password"}
                      value={fishKeyInput}
                      onChange={(e) => setFishKeyInput(e.target.value)}
                      placeholder="Fish Audio API key (from fish.audio dashboard)..."
                      className="ev-input"
                      autoComplete="off"
                      style={{
                        paddingRight: 38,
                        fontFamily: "var(--font-geist-mono), monospace",
                        fontSize: 12.5,
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => setShowFishKey((v) => !v)}
                      aria-label={showFishKey ? "Hide Fish Audio key" : "Show Fish Audio key"}
                      style={{
                        position: "absolute",
                        right: 8,
                        top: "50%",
                        transform: "translateY(-50%)",
                        background: "transparent",
                        border: "none",
                        color: "var(--color-ev-muted)",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        padding: 4,
                      }}
                    >
                      {showFishKey ? (
                        <EyeOff style={{ width: 15, height: 15 }} />
                      ) : (
                        <Eye style={{ width: 15, height: 15 }} />
                      )}
                    </button>
                  </div>
                  <button
                    type="button"
                    className="ev-btn ev-btn-primary ev-btn-sm"
                    onClick={() => void handleSaveFishKey()}
                  >
                    Save Key
                  </button>
                  {fishKey && (
                    <button
                      type="button"
                      className="ev-btn ev-btn-ghost ev-btn-sm"
                      onClick={() => void handleClearFishKey()}
                      title="Clear Fish Audio API key"
                      style={{ color: "#ff857a" }}
                    >
                      <Trash2 style={{ width: 14, height: 14 }} /> Clear
                    </button>
                  )}
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))",
                    gap: 8,
                    marginBottom: 12,
                  }}
                >
                  {VOICE_OPTIONS.map((v) => {
                    const referenceId = voicePresets.find((p) => p.slot === v.id)?.referenceId.trim() ?? "";
                    const isSelected = !!referenceId && selectedVoice === referenceId;
                    return (
                      <button
                        key={v.id}
                        type="button"
                        disabled={!referenceId}
                        onClick={() => void handleSelectVoice(referenceId, v.name)}
                        title={referenceId ? `reference_id: ${referenceId}` : "Paste a reference_id below to enable this slot"}
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "flex-start",
                          gap: 3,
                          padding: "9px 12px",
                          borderRadius: 8,
                          border: isSelected
                            ? "1px solid #35e0ff"
                            : "1px solid var(--color-ev-line)",
                          background: isSelected
                            ? "rgba(18, 51, 61, 0.55)"
                            : "#0e1318",
                          color: isSelected ? "#c9f3ff" : "var(--color-ev-ink)",
                          cursor: referenceId ? "pointer" : "not-allowed",
                          opacity: referenceId ? 1 : 0.55,
                          textAlign: "left",
                          transition: "border-color 0.15s, background 0.15s",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            width: "100%",
                          }}
                        >
                          <span style={{ fontSize: 13, fontWeight: 600 }}>{v.name} (Fish)</span>
                          {isSelected && (
                            <Check style={{ width: 13, height: 13, color: "#35e0ff" }} />
                          )}
                        </div>
                        <span
                          style={{
                            fontSize: 11,
                            color: isSelected ? "#9ee7f5" : "var(--color-ev-muted)",
                          }}
                        >
                          {v.desc}
                        </span>
                        <span
                          style={{
                            fontSize: 10.5,
                            fontFamily: "var(--font-geist-mono), monospace",
                            color: isSelected ? "#9ee7f5" : "var(--color-ev-muted)",
                            wordBreak: "break-all",
                          }}
                        >
                          {referenceId ? `id: ${referenceId}` : "no reference_id yet"}
                        </span>
                      </button>
                    );
                  })}
                </div>
                {VOICE_OPTIONS.map((v) => {
                  const preset = voicePresets.find((p) => p.slot === v.id);
                  return (
                    <form
                      key={`edit-${v.id}`}
                      onSubmit={(e) => void handleSavePresetId(e, v.id)}
                      style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}
                    >
                      <span style={{ fontSize: 12, width: 76, flexShrink: 0 }}>{v.name}</span>
                      <input
                        type="text"
                        name="referenceId"
                        defaultValue={preset?.referenceId ?? ""}
                        key={`${v.id}:${preset?.referenceId ?? ""}`}
                        placeholder={`Paste Fish reference_id for ${v.name}...`}
                        aria-label={`Fish Audio reference_id for ${v.name}`}
                        className="ev-input"
                        style={{
                          fontSize: 12.5,
                          fontFamily: "var(--font-geist-mono), monospace",
                        }}
                      />
                      <button
                        type="submit"
                        className="ev-btn ev-btn-sm"
                        style={{ whiteSpace: "nowrap" }}
                      >
                        Save
                      </button>
                    </form>
                  );
                })}
                <form
                  onSubmit={(e) => void handleSetCustomVoice(e)}
                  style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 4, marginBottom: 16 }}
                >
                  <input
                    type="text"
                    value={customVoiceInput}
                    onChange={(e) => setCustomVoiceInput(e.target.value)}
                    placeholder="Or paste any Fish reference_id to use immediately..."
                    aria-label="Custom Fish Audio reference_id"
                    className="ev-input"
                    style={{
                      fontSize: 12.5,
                      fontFamily: "var(--font-geist-mono), monospace",
                    }}
                  />
                  <button
                    type="submit"
                    disabled={!customVoiceInput.trim()}
                    className="ev-btn ev-btn-sm"
                    style={{ whiteSpace: "nowrap" }}
                  >
                    Use Custom
                  </button>
                </form>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: 8,
                    paddingTop: 12,
                    borderTop: "1px solid var(--color-ev-line)",
                  }}
                >
                  <label
                    htmlFor="eleven-key-input"
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: "var(--color-ev-ink)",
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    <Key style={{ width: 14, height: 14, color: "#35e0ff" }} />
                    ElevenLabs API Key
                  </label>
                  <StatusPill tone={elevenKey ? "ok" : "mute"}>
                    {elevenKey ? "Key set in UI" : "Optional — not set"}
                  </StatusPill>
                </div>
                <p
                  style={{
                    fontSize: 12,
                    color: "var(--color-ev-muted)",
                    marginBottom: 12,
                    lineHeight: 1.5,
                  }}
                >
                  Optional — free voices above always work. When a key and a voice ID are both
                  saved, previews and voice mode use ElevenLabs (free ~10k chars/month @
                  elevenlabs.io). Stored in this browser only.
                </p>
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
                  <div style={{ position: "relative", flex: 1 }}>
                    <input
                      id="eleven-key-input"
                      type={showElevenKey ? "text" : "password"}
                      value={elevenKeyInput}
                      onChange={(e) => setElevenKeyInput(e.target.value)}
                      placeholder="ElevenLabs API key (optional)..."
                      className="ev-input"
                      autoComplete="off"
                      style={{
                        paddingRight: 38,
                        fontFamily: "var(--font-geist-mono), monospace",
                        fontSize: 12.5,
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => setShowElevenKey((v) => !v)}
                      aria-label={showElevenKey ? "Hide ElevenLabs key" : "Show ElevenLabs key"}
                      style={{
                        position: "absolute",
                        right: 8,
                        top: "50%",
                        transform: "translateY(-50%)",
                        background: "transparent",
                        border: "none",
                        color: "var(--color-ev-muted)",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        padding: 4,
                      }}
                    >
                      {showElevenKey ? (
                        <EyeOff style={{ width: 15, height: 15 }} />
                      ) : (
                        <Eye style={{ width: 15, height: 15 }} />
                      )}
                    </button>
                  </div>
                  <button
                    type="button"
                    className="ev-btn ev-btn-primary ev-btn-sm"
                    onClick={() => void handleSaveElevenKey()}
                  >
                    Save Key
                  </button>
                  {elevenKey && (
                    <button
                      type="button"
                      className="ev-btn ev-btn-ghost ev-btn-sm"
                      onClick={() => void handleClearElevenKey()}
                      title="Clear ElevenLabs API key"
                      style={{ color: "#ff857a" }}
                    >
                      <Trash2 style={{ width: 14, height: 14 }} /> Clear
                    </button>
                  )}
                </div>
                <form
                  onSubmit={(e) => { e.preventDefault(); void handleSaveElevenVoice(); }}
                  style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 16 }}
                >
                  <input
                    type="text"
                    value={elevenVoiceInput}
                    onChange={(e) => setElevenVoiceInput(e.target.value)}
                    placeholder="ElevenLabs voice_id (optional, from elevenlabs.io dashboard)..."
                    aria-label="ElevenLabs voice_id"
                    className="ev-input"
                    style={{
                      fontSize: 12.5,
                      fontFamily: "var(--font-geist-mono), monospace",
                    }}
                  />
                  <button
                    type="submit"
                    className="ev-btn ev-btn-sm"
                    style={{ whiteSpace: "nowrap" }}
                  >
                    Save Voice
                  </button>
                </form>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: 8,
                    paddingTop: 12,
                    borderTop: "1px solid var(--color-ev-line)",
                  }}
                >
                  <label
                    htmlFor="azure-key-input"
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: "var(--color-ev-ink)",
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    <Key style={{ width: 14, height: 14, color: "#35e0ff" }} />
                    Azure Speech Key
                  </label>
                  <StatusPill tone={azureKey ? "ok" : "mute"}>
                    {azureKey ? "Key set in UI" : "Optional — not set"}
                  </StatusPill>
                </div>
                <p
                  style={{
                    fontSize: 12,
                    color: "var(--color-ev-muted)",
                    marginBottom: 12,
                    lineHeight: 1.5,
                  }}
                >
                  Optional — free voices above always work. When a key and a region are both
                  saved, previews and voice mode use Azure Speech (same Neural voices, official
                  quota). Stored in this browser only.
                </p>
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
                  <div style={{ position: "relative", flex: 1 }}>
                    <input
                      id="azure-key-input"
                      type={showAzureKey ? "text" : "password"}
                      value={azureKeyInput}
                      onChange={(e) => setAzureKeyInput(e.target.value)}
                      placeholder="Azure Speech key (optional)..."
                      className="ev-input"
                      autoComplete="off"
                      style={{
                        paddingRight: 38,
                        fontFamily: "var(--font-geist-mono), monospace",
                        fontSize: 12.5,
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => setShowAzureKey((v) => !v)}
                      aria-label={showAzureKey ? "Hide Azure Speech key" : "Show Azure Speech key"}
                      style={{
                        position: "absolute",
                        right: 8,
                        top: "50%",
                        transform: "translateY(-50%)",
                        background: "transparent",
                        border: "none",
                        color: "var(--color-ev-muted)",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        padding: 4,
                      }}
                    >
                      {showAzureKey ? (
                        <EyeOff style={{ width: 15, height: 15 }} />
                      ) : (
                        <Eye style={{ width: 15, height: 15 }} />
                      )}
                    </button>
                  </div>
                  <button
                    type="button"
                    className="ev-btn ev-btn-primary ev-btn-sm"
                    onClick={() => void handleSaveAzureKey()}
                  >
                    Save Key
                  </button>
                  {azureKey && (
                    <button
                      type="button"
                      className="ev-btn ev-btn-ghost ev-btn-sm"
                      onClick={() => void handleClearAzureKey()}
                      title="Clear Azure Speech key"
                      style={{ color: "#ff857a" }}
                    >
                      <Trash2 style={{ width: 14, height: 14 }} /> Clear
                    </button>
                  )}
                </div>
                <form
                  onSubmit={(e) => { e.preventDefault(); void handleSaveAzureRegion(); }}
                  style={{ display: "flex", gap: 8, alignItems: "center" }}
                >
                  <input
                    type="text"
                    value={azureRegionInput}
                    onChange={(e) => setAzureRegionInput(e.target.value)}
                    placeholder="Azure region (optional, e.g. southeastasia)..."
                    aria-label="Azure Speech region"
                    className="ev-input"
                    style={{
                      fontSize: 12.5,
                      fontFamily: "var(--font-geist-mono), monospace",
                    }}
                  />
                  <button
                    type="submit"
                    className="ev-btn ev-btn-sm"
                    style={{ whiteSpace: "nowrap" }}
                  >
                    Save Region
                  </button>
                </form>
              </div>
            )}
          </div>
        </section>

        {/* Wake word — opt-in via this switch; the listener itself never
            auto-starts and shows a persistent armed banner when on. */}
        <section
          style={{
            marginBottom: 22,
            paddingBottom: 20,
            borderBottom: "1px solid var(--color-ev-line)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <div>
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: "var(--color-ev-ink)",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 4,
                }}
              >
                <Mic
                  style={{
                    width: 14,
                    height: 14,
                    color: "var(--color-ev-muted)",
                  }}
                />
                Wake Word: &quot;Hey E.V.&quot;
                <span
                  style={{
                    fontSize: 10.5,
                    fontWeight: 700,
                    letterSpacing: "0.04em",
                    textTransform: "uppercase",
                    color: settings.wakeWordEnabled ? "#7cf5b0" : "var(--color-ev-muted)",
                    border: settings.wakeWordEnabled
                      ? "1px solid rgba(124, 245, 176, 0.4)"
                      : "1px solid var(--color-ev-line)",
                    background: settings.wakeWordEnabled
                      ? "rgba(124, 245, 176, 0.08)"
                      : "rgba(255, 255, 255, 0.03)",
                    borderRadius: 999,
                    padding: "2px 8px",
                  }}
                >
                  {settings.wakeWordEnabled ? "Armed" : "Off"}
                </span>
              </span>
              <p
                style={{
                  fontSize: 12,
                  color: "var(--color-ev-muted)",
                  margin: 0,
                  lineHeight: 1.5,
                }}
              >
                Listen in the background for &quot;Hey E.V.&quot; or &quot;E.V.&quot; to instantly activate voice mode.
                Never runs unless you arm it here; a banner on every page shows when it is listening.
              </p>
            </div>

            <button
              type="button"
              role="switch"
              aria-checked={Boolean(settings.wakeWordEnabled)}
              title={settings.wakeWordEnabled ? "Disarm wake word" : "Arm wake word"}
              onClick={() => {
                const next = !settings.wakeWordEnabled;
                void setWakeWordEnabled(next);
                void recordActivity(
                  "system",
                  next ? "Wake word armed ('Hey E.V.')" : "Wake word disarmed",
                );
              }}
              style={{
                position: "relative",
                width: 44,
                height: 24,
                borderRadius: 12,
                background: settings.wakeWordEnabled
                  ? "rgba(124, 245, 176, 0.55)"
                  : "rgba(255, 255, 255, 0.15)",
                border: "none",
                cursor: "pointer",
                transition: "background 0.2s ease",
                padding: 2,
                flexShrink: 0,
              }}
            >
              <span
                style={{
                  display: "block",
                  width: 20,
                  height: 20,
                  borderRadius: 10,
                  background: "#ffffff",
                  transform: settings.wakeWordEnabled
                    ? "translateX(20px)"
                    : "translateX(0)",
                  transition: "transform 0.2s ease, background 0.2s ease",
                }}
              />
            </button>
          </div>
        </section>

        {/* Feedback / status banner */}
        {feedback && (
          <div
            className="ev-banner"
            role="status"
            style={{ marginBottom: 16, padding: "8px 12px", fontSize: 12.5 }}
          >
            <span>{feedback}</span>
          </div>
        )}

        {/* Footer actions */}
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
            borderTop: "1px solid var(--color-ev-line)",
            paddingTop: 14,
          }}
        >
          <button
            type="button"
            className="ev-btn ev-btn-primary ev-btn-sm"
            onClick={handleClose}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;
