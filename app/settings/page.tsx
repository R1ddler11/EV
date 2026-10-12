/* PROJECT E.V. — Settings (frontend-owned).
   The full settings surface, replacing the retired modal:
   Conversation (chat register, speak-aloud + speech voice,
   transcript persistence), Voice (the ACTIVE-voice chooser —
   free / Fish-via-OpenRouter — plus the premium provider keys
   and the editable Fish preset slots), Advanced (OpenRouter key
   + model override, memory, wake word) and About. Every control
   binds to the real AppSettings through the store — the same
   fields, persistence and defaults the modal used. GSAP drives
   the entrance (.ev-enter, the same pattern as the other
   pages); motion is skipped under prefers-reduced-motion or the
   manual override. */
"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import {
  Brain,
  Check,
  Cpu,
  Eye,
  EyeOff,
  GitFork,
  Key,
  LayoutDashboard,
  MessagesSquare,
  Mic,
  Plus,
  ShieldCheck,
  Sparkles,
  Stethoscope,
  Trash2,
  Volume2,
} from "lucide-react";
import { ModeToggle, useSpeakAloud } from "@/components/chat";
import { SectionLabel, StatusPill } from "@/components/ui";
import { FeatureCard, GuideCard } from "@/components/ui/settings";
import { BackendUnavailableError, speakText } from "@/lib/api";
import {
  DEFAULT_FISH_VOICE_PRESETS,
  isLegacyVoiceId,
} from "@/lib/config/voice";
import { motionAllowed } from "@/lib/motion";
import { useEv } from "@/lib/store";
import { DEFAULT_SETTINGS } from "@/lib/types";
import pkg from "@/package.json";
import {
  ActiveBadge,
  FREE_VOICE_OPTIONS,
  PRESET_MODELS,
  VOICE_OPTIONS,
  describeTtsProvider,
  fishVoiceLabel,
  resolveActiveVoice,
  savedFishVoices,
  speakOptionsForVoice,
  truncateId,
  type ActiveVoice,
} from "@/lib/voice-options";
import { cn } from "@/lib/utils";

const SECTIONS = [
  { id: "conversation", label: "Conversation" },
  { id: "voice", label: "Voice" },
  { id: "advanced", label: "Advanced" },
  { id: "about", label: "About" },
] as const;

export default function SettingsPage() {
  const root = useRef<HTMLDivElement>(null);
  const {
    settings,
    ready,
    backendConfigured,
    updateSettings,
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
    setChatMode,
    recordActivity,
  } = useEv();
  // Speak-aloud state is the SAME hook the assistant composer
  // uses — one implementation of the toggle, the voice list
  // and the pick.
  const speak = useSpeakAloud();

  const [keyInput, setKeyInput] = useState(settings.openRouterApiKey ?? "");
  const [showKey, setShowKey] = useState(false);
  const [fishKeyInput, setFishKeyInput] = useState(settings.fishAudioApiKey ?? "");
  const [showFishKey, setShowFishKey] = useState(false);
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
  const [activeSection, setActiveSection] = useState<string>(
    SECTIONS[0]?.id ?? "conversation",
  );

  // Scroll-spy for the section rail: the entry for the
  // section currently in view carries the active state.
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActiveSection(entry.target.id);
        }
      },
      { rootMargin: "-15% 0px -70% 0px" },
    );
    for (const section of SECTIONS) {
      const node = document.getElementById(section.id);
      if (node) observer.observe(node);
    }
    return () => observer.disconnect();
  }, []);

  // Keep the editable key inputs in sync when the stored
  // values change elsewhere (another surface, another tab).
  const [prevApiKey, setPrevApiKey] = useState(settings.openRouterApiKey);
  const [prevFishKey, setPrevFishKey] = useState(settings.fishAudioApiKey);
  const [prevFishVoiceId, setPrevFishVoiceId] = useState(settings.fishVoiceViaOpenRouter);
  const [prevElevenKey, setPrevElevenKey] = useState(settings.elevenLabsApiKey);
  const [prevElevenVoice, setPrevElevenVoice] = useState(settings.elevenLabsVoiceId);
  const [prevAzureKey, setPrevAzureKey] = useState(settings.azureSpeechKey);
  const [prevAzureRegion, setPrevAzureRegion] = useState(settings.azureSpeechRegion);
  if (
    settings.openRouterApiKey !== prevApiKey ||
    settings.fishAudioApiKey !== prevFishKey ||
    settings.fishVoiceViaOpenRouter !== prevFishVoiceId ||
    settings.elevenLabsApiKey !== prevElevenKey ||
    settings.elevenLabsVoiceId !== prevElevenVoice ||
    settings.azureSpeechKey !== prevAzureKey ||
    settings.azureSpeechRegion !== prevAzureRegion
  ) {
    setPrevApiKey(settings.openRouterApiKey);
    setKeyInput(settings.openRouterApiKey ?? "");
    setPrevFishKey(settings.fishAudioApiKey);
    setFishKeyInput(settings.fishAudioApiKey ?? "");
    setPrevFishVoiceId(settings.fishVoiceViaOpenRouter);
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
  }

  // Stop any in-flight preview when leaving the page.
  useEffect(() => {
    return () => {
      if (previewAudioRef.current) {
        previewAudioRef.current.pause();
        previewAudioRef.current = null;
      }
    };
  }, []);

  const reduced = !motionAllowed(settings.reducedMotionOverride);
  useGSAP(
    () => {
      if (reduced || !root.current) return;
      const ctx = gsap.context(() => {
        gsap.from(".ev-enter", {
          opacity: 0,
          y: 18,
          duration: 0.6,
          stagger: 0.08,
          ease: "power2.out",
          clearProps: "all",
        });
      }, root);
      return () => ctx.revert();
    },
    { scope: root, dependencies: [ready] },
  );

  const currentKey = (settings.openRouterApiKey ?? "").trim();
  const currentModel = settings.openRouterModel || "anthropic/claude-3.5-sonnet";

  // Derive key status: UI key vs server key vs none.
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

  const handleSetCustomModel = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = customModelInput.trim();
    if (!trimmed) return;
    await setOpenRouterModel(trimmed);
    await recordActivity("system", `Active model set to custom: ${trimmed}`);
    setCustomModelInput("");
    setFeedback(`Model set to ${trimmed}`);
    setTimeout(() => setFeedback(null), 2000);
  };

  // Voice selection. Free Edge voice IDs (or no selection = server
  // free default) speak with no key; Fish premium reference_ids
  // speak with the stored Fish key. The selected ID is what
  // speakText sends — display names never leave the UI.
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

  const handleSavePresetId = async (e: FormEvent<HTMLFormElement>, slot: string) => {
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

  const handleSetCustomVoice = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = customVoiceInput.trim();
    if (!trimmed) return;
    await setTtsVoice(trimmed);
    await recordActivity("voice", `Voice set to custom reference_id ${trimmed}`);
    setCustomVoiceInput("");
    setFeedback(`Voice set to ${trimmed}`);
    setTimeout(() => setFeedback(null), 2000);
  };

  // Preview speaks the voice it is handed: a free card previews its
  // Neural id on the free path, a Fish card previews that model id
  // through provider "openrouter-fish". Feedback names the voice and
  // the provider the server actually used, read from the response
  // headers.
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
    <div className="ev-stack" ref={root}>
      <header className="ev-page-head">
        <SectionLabel>E.V. // Settings</SectionLabel>
        <h1 className="ev-h1">Settings</h1>
        <p className="ev-lede">
          Conversation, voice, keys and model — every control below
          writes to the settings E.V. persists in this browser
          (IndexedDB). Same fields, same defaults, nothing decorative.
        </p>
      </header>

      {feedback && (
        <div className="ev-banner" role="status">
          <span>{feedback}</span>
        </div>
      )}

      <div className="grid gap-8 lg:grid-cols-[180px_1fr]">
        <nav
          className="ev-stack self-start lg:sticky"
          style={{ gap: 2, top: "calc(var(--ev-topbar-h) + 16px)" }}
          aria-label="Settings sections"
        >
          {SECTIONS.map((section) => (
            <a
              key={section.id}
              href={`#${section.id}`}
              className={cn(
                "text-[12.5px] rounded-[8px] px-3 py-2 transition-colors border",
                activeSection === section.id
                  ? "text-ev-ink border-ev-line2"
                  : "text-ev-muted border-transparent hover:text-ev-ink hover:border-ev-line",
              )}
            >
              {section.label}
            </a>
          ))}
        </nav>

        <div className="ev-stack" style={{ gap: 28 }}>
          {/* ---------------- Conversation ---------------- */}
          <section id="conversation" aria-labelledby="conversation-heading">
            <h2 id="conversation-heading" className="ev-label">
              Conversation
            </h2>
            <div className="ev-panel ev-enter" style={{ marginTop: 10 }}>
              <SectionLabel>Conversation</SectionLabel>
              <p className="ev-lede" style={{ fontSize: 13.5, marginTop: 6 }}>
                How E.V. talks with you: the register every chat
                request is sent in, whether text-chat replies are
                read aloud, and whether voice dictation is kept.
              </p>

              <div className="ev-toggle">
                <span>
                  <strong>Chat register</strong>
                  <br />
                  <span className="ev-hint">
                    Daily — ordinary conversation, no system talk.
                    Builder — technical answers; commands and tools
                    welcome.
                  </span>
                </span>
                <ModeToggle
                  mode={settings.chatMode ?? "daily"}
                  onChange={(mode) => void setChatMode(mode)}
                />
              </div>

              <div className="ev-toggle">
                <span>
                  <strong>Speak replies aloud</strong>
                  <br />
                  <span className="ev-hint">
                    Browser speech synthesis reads E.V.&apos;s text-chat
                    answers. Default off.
                  </span>
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={speak.enabled}
                  aria-label="Read E.V.'s replies aloud"
                  className="ev-switch"
                  onClick={speak.toggle}
                />
              </div>

              {speak.enabled && speak.voices.length > 0 && (
                <div className="ev-toggle">
                  <span>
                    <strong>Speech voice</strong>
                    <br />
                    <span className="ev-hint">
                      The system voice used for speak-aloud — the
                      platform default when unset.
                    </span>
                  </span>
                  <select
                    className="ev-input"
                    aria-label="Speak-aloud voice"
                    value={speak.voiceURI}
                    onChange={(event) => speak.pickVoice(event.target.value)}
                    style={{ width: "auto", maxWidth: 220 }}
                  >
                    <option value="">Default voice</option>
                    {speak.voices.map((voice) => (
                      <option key={voice.voiceURI} value={voice.voiceURI}>
                        {voice.name} ({voice.lang})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {speak.enabled && speak.notice && (
                <p className="ev-hint" role="status">
                  {speak.notice}
                </p>
              )}

              <div className="ev-toggle">
                <span>
                  <strong>Save voice transcripts to history</strong>
                  <br />
                  <span className="ev-hint">
                    Off means dictation vanishes when the session ends.
                  </span>
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={settings.transcriptPersistence}
                  aria-label="Toggle transcript persistence"
                  className="ev-switch"
                  onClick={() =>
                    void updateSettings({
                      transcriptPersistence: !settings.transcriptPersistence,
                    })
                  }
                />
              </div>
            </div>
          </section>

          {/* ---------------- Voice ---------------- */}
          <section id="voice" aria-labelledby="voice-heading">
            <h2 id="voice-heading" className="ev-label">
              Voice
            </h2>
            <div className="ev-panel ev-enter" style={{ marginTop: 10 }}>
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
                <strong style={{ color: "#35e0ff" }}>ACTIVE</strong> is
                the one E.V. speaks with — here and on the Voice page.
                Click any voice to make it active; Preview always speaks
                the voice it sits on.
              </p>

              {legacyStoredVoice && (
                <div
                  className="ev-banner"
                  role="status"
                  style={{ marginBottom: 12, padding: "8px 12px", fontSize: 12.5 }}
                >
                  <span>
                    Stored voice &quot;{selectedVoice}&quot; is a legacy OpenAI
                    voice name — E.V. speaks the free default instead.
                    Pick a free voice below to save a new active voice.
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
                  <SectionLabel>
                    FISH VIA OPENROUTER · free model, needs your OpenRouter key
                  </SectionLabel>
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
                  Fish-quality voices through the free S2.1 Pro Free
                  model on OpenRouter — no Fish key or credits needed.
                  Paste a Fish voice model id (the hex id from the
                  OpenRouter playground) and add it; then click it to
                  make it the active voice. The OpenRouter key in
                  Advanced is reused.
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
                    No Fish voices saved yet. To add one: open the
                    OpenRouter playground, copy a Fish voice model id
                    (the hex id), paste it above and press Add voice.
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
                  <span>
                    Premium (optional){fishKey || elevenKey || azureKey ? " · key saved" : ""}
                  </span>
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
                      Optional premium voices: Fish Audio
                      (https://fish.audio), ElevenLabs
                      (https://elevenlabs.io), and Azure Speech. Paste
                      an optional key below with its voice/region —
                      keys are never required. Free voices above
                      always work.
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
                      Optional — free voices above always work. When a
                      key and a voice ID are both saved, previews and
                      voice mode use ElevenLabs (free ~10k chars/month
                      @ elevenlabs.io). Stored in this browser only.
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
                      onSubmit={(e) => {
                        e.preventDefault();
                        void handleSaveElevenVoice();
                      }}
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
                      Optional — free voices above always work. When a
                      key and a region are both saved, previews and
                      voice mode use Azure Speech (same Neural voices,
                      official quota). Stored in this browser only.
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
                      onSubmit={(e) => {
                        e.preventDefault();
                        void handleSaveAzureRegion();
                      }}
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
            </div>
          </section>

          {/* ---------------- Advanced ---------------- */}
          <section id="advanced" aria-labelledby="advanced-heading">
            <h2 id="advanced-heading" className="ev-label">
              Advanced
            </h2>
            <div className="ev-stack" style={{ gap: 10, marginTop: 10 }}>
              <div className="ev-panel ev-enter">
                <SectionLabel>Model &amp; provider</SectionLabel>

                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginTop: 10,
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
                  Keys entered here stay strictly in your browser&apos;s
                  IndexedDB and are forwarded with chat requests. When
                  left blank, E.V. utilizes the server-configured
                  environment key.
                </p>

                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <div style={{ position: "relative", flex: 1 }}>
                    <input
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

                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginTop: 20,
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
                  Select from popular OpenRouter models or specify any
                  custom model ID.
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
              </div>

              <div className="ev-panel ev-enter">
                <SectionLabel>Console preferences</SectionLabel>

                <div className="ev-toggle" style={{ marginTop: 10 }}>
                  <span>
                    <strong>Memory context</strong>
                    <br />
                    <span className="ev-hint">
                      Approved memories ride along with chat requests.
                      Existing entries stay until you delete them.
                    </span>
                  </span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={settings.memoryEnabled}
                    aria-label="Toggle memory context"
                    className="ev-switch"
                    onClick={() =>
                      void updateSettings({ memoryEnabled: !settings.memoryEnabled })
                    }
                  />
                </div>

                {/* Wake word — opt-in via this switch; the
                    listener itself never auto-starts and shows a
                    persistent armed banner when on. */}
                <div
                  className="ev-toggle"
                  style={{ marginTop: 12, paddingTop: 14, borderTop: "1px solid var(--color-ev-line)" }}
                >
                  <span>
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
                    <br />
                    <span className="ev-hint">
                      Listen in the background for &quot;Hey E.V.&quot; or &quot;E.V.&quot;
                      to instantly activate voice mode. Never runs
                      unless you arm it here; a banner on every page
                      shows when it is listening.
                    </span>
                  </span>

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
              </div>
            </div>
          </section>

          {/* ---------------- About ---------------- */}
          <section id="about" aria-labelledby="about-heading">
            <h2 id="about-heading" className="ev-label">
              About
            </h2>
            <div className="ev-stack" style={{ gap: 10, marginTop: 10 }}>
              <div className="ev-panel ev-enter">
                <SectionLabel>Project E.V.</SectionLabel>
                <p className="ev-lede" style={{ fontSize: 13.5, marginTop: 6 }}>
                  A local-first, voice-first console. E.V. thinks out
                  loud in the orb, talks back through real
                  text-to-speech, and remembers only what you approve —
                  every byte of it in this browser.
                </p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <FeatureCard
                    icon={ShieldCheck}
                    title="Local-first"
                    description="Conversations, notes, approved memories, keys and settings persist in IndexedDB — on this machine only. Nothing syncs anywhere."
                  />
                  <FeatureCard
                    icon={Mic}
                    title="Voice link"
                    description="Realtime cloud voice or local dictation, with E.V.'s spoken replies captured as recordings you can save."
                  />
                  <FeatureCard
                    icon={Brain}
                    title="Memory vault"
                    description="User-approved memories and a full activity ledger — inspectable, editable and deletable at any time."
                  />
                  <FeatureCard
                    icon={Cpu}
                    title="Honest by design"
                    description="Every status pill, simulation flag and provider name reports what actually happened — never a plausible story."
                  />
                </div>
              </div>

              <div className="ev-panel ev-enter">
                <SectionLabel>Version facts</SectionLabel>
                <dl className="ev-stack" style={{ gap: 8, marginTop: 10 }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      justifyContent: "space-between",
                      gap: 16,
                    }}
                  >
                    <dt className="ev-hint">Console version</dt>
                    <dd className="ev-mono" style={{ margin: 0 }}>
                      {pkg.version}
                    </dd>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      justifyContent: "space-between",
                      gap: 16,
                    }}
                  >
                    <dt className="ev-hint">Default model</dt>
                    <dd className="ev-mono" style={{ margin: 0 }}>
                      {DEFAULT_SETTINGS.openRouterModel}
                    </dd>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      justifyContent: "space-between",
                      gap: 16,
                    }}
                  >
                    <dt className="ev-hint">Storage</dt>
                    <dd className="ev-mono" style={{ margin: 0 }}>
                      IndexedDB — this browser only
                    </dd>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      justifyContent: "space-between",
                      gap: 16,
                    }}
                  >
                    <dt className="ev-hint">API keys</dt>
                    <dd className="ev-mono" style={{ margin: 0 }}>
                      Stored in this browser; never logged
                    </dd>
                  </div>
                </dl>
              </div>

              <div className="ev-panel ev-enter">
                <SectionLabel>Links</SectionLabel>
                <div className="ev-stack" style={{ gap: 10, marginTop: 10 }}>
                  <GuideCard
                    icon={GitFork}
                    title="Source — GitHub"
                    description="The E.V. console repository: R1ddler11/EV."
                    href="https://github.com/R1ddler11/EV"
                    target="_blank"
                    rel="noreferrer"
                  />
                  <GuideCard
                    asChild
                    icon={LayoutDashboard}
                    title="Overview"
                    description="The orb hero, live status, diagnostics summary and recent activity."
                  >
                    <Link href="/" />
                  </GuideCard>
                  <GuideCard
                    asChild
                    icon={MessagesSquare}
                    title="Assistant"
                    description="Text chat with daily/builder registers, tools and follow-ups."
                  >
                    <Link href="/assistant" />
                  </GuideCard>
                  <GuideCard
                    asChild
                    icon={Mic}
                    title="Voice mode"
                    description="Realtime voice link or local dictation, with saved recordings."
                  >
                    <Link href="/voice" />
                  </GuideCard>
                  <GuideCard
                    asChild
                    icon={Brain}
                    title="Memory vault"
                    description="Notes, approved memories, conversation history and the activity ledger."
                  >
                    <Link href="/memory" />
                  </GuideCard>
                  <GuideCard
                    asChild
                    icon={Stethoscope}
                    title="Diagnostics"
                    description="The deterministic subsystem scan — what is real vs simulated."
                  >
                    <Link href="/diagnostics" />
                  </GuideCard>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
