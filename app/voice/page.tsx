/* PROJECT E.V. — Voice Mode (frontend-owned).
   One conversation, two links, one transcript and one history:
   1. REAL hands-free path (default): one gesture -> getUserMedia ->
      POST /api/voice/session -> WebRTC realtime session configured with
      semantic VAD + create_response + interrupt_response. The mic stays hot
      for the whole conversation: speak, E.V. answers, speak again. Talk
      over E.V. to cut the answer off (response.cancel + output buffer
      clear + server-side truncation). The 10-minute ephemeral secret is
      re-minted transparently at a quiet point and the recent transcript is
      carried into the replacement session as real conversation items.
   2. Conversational local mode (fallback when the realtime link cannot be
      established): Web Speech dictation -> /api/chat -> /api/voice/tts.
      Labelled honestly; never silently faked.
   Every visible state comes from a real realtime data-channel event; the
   page never guesses, never times a "success" that did not happen. */
"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  Mic,
  MicOff,
  PhoneOff,
  Save,
  Send,
  Square,
  Volume2,
  VolumeX,
} from "lucide-react";
import { VoicePoweredOrb } from "@/components/ui/voice-powered-orb";
import LevelMeter from "@/components/voice/level-meter";
import SavedRecordings from "@/components/voice/saved-recordings";
import CloudPill from "@/components/cloud-pill";
import { SectionLabel, StatusPill } from "@/components/ui";
import {
  ActiveBadge,
  FREE_VOICE_OPTIONS,
  fishVoiceLabel,
  resolveActiveVoice,
  savedFishVoices,
  speakOptionsForVoice,
  truncateId,
} from "@/components/settings-modal";
import {
  BackendUnavailableError,
  createVoiceSession,
  postChatStream,
  speakText,
  type ChatPayloadMessage,
  type VoiceSessionPayload,
} from "@/lib/api";
import { PersistenceError, saveRecording } from "@/lib/db";
import {
  startRealtimeSession,
  type RealtimeHandle,
  type RealtimePhase,
  type RealtimeRateLimit,
} from "@/lib/realtime";
import {
  SessionRecorder,
  formatDurationSec,
} from "@/lib/voice-recording";
import {
  newId,
  type CoreState,
  type Recording,
} from "@/lib/types";
import { motionAllowed } from "@/lib/motion";
import { useEv } from "@/lib/store";

type VoicePhase =
  | "ready"
  | "requesting"
  | "live"
  | "ending"
  | "denied"
  | "unsupported";

/** Live cloud realtime link vs local dictation + chat + TTS. */
type LinkMode = "realtime" | "local";

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechResultEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

interface SpeechResultEventLike {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
}

function getRecognizer(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as Record<string, unknown>;
  const ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  if (typeof ctor !== "function") return null;
  return ctor as new () => SpeechRecognitionLike;
}

interface TranscriptLine {
  speaker: "user" | "assistant";
  text: string;
  /** Cut off by barge-in: shown as a fragment, never as a full answer. */
  interrupted?: boolean;
}

/** Auto-title a saved segment from its first user line. */
function recordingTitle(lines: TranscriptLine[], fromIndex: number): string {
  const firstUser = lines.slice(fromIndex).find((line) => line.speaker === "user");
  const clean = (firstUser?.text ?? "").replace(/\s+/g, " ").trim();
  if (!clean) return "Voice recording";
  return clean.length > 44 ? `${clean.slice(0, 44)}…` : clean;
}

/** Honest copy for the E.V.-only recording UI. */
const REC_LABEL = "E.V.'s voice";
const WAITING_REALTIME =
  "Waiting for E.V.'s voice — the recording starts the moment she speaks.";
const WAITING_LOCAL =
  "E.V.'s spoken replies are captured as she answers — text-to-speech audio, not your microphone.";
const CAPTURING_LOCAL =
  "Recording E.V.'s spoken replies — text-to-speech audio, not your microphone.";
const DISCARD_HINT =
  "The unsaved tail is discarded when the session ends — press Save recording for anything worth keeping.";
const UNSUPPORTED_HINT =
  "Audio capture is not supported in this browser — recordings are unavailable, everything else works.";

const REALTIME_TO_CORE: Record<RealtimePhase, CoreState> = {
  connecting: "connecting",
  renewing: "connecting",
  live: "listening",
  speaking: "speaking",
  listening: "listening",
  processing: "processing",
  interrupted: "interrupted",
  ended: "idle",
  error: "error",
};

const LINK_LABEL: Record<RealtimePhase, string> = {
  connecting: "Linking voice link",
  renewing: "Renewing voice link",
  live: "Live",
  speaking: "E.V. speaking",
  listening: "Listening",
  processing: "E.V. thinking",
  interrupted: "Barge-in — answer cut",
  ended: "Session ended",
  error: "Voice link error",
};

function VoiceInner() {
  const searchParams = useSearchParams();
  const {
    active,
    activeId,
    newConversation,
    appendMessage,
    setCoreState,
    settings,
    setTtsVoice,
    setActiveVoiceSource,
    setFishVoiceViaOpenRouter,
    memories,
    notes,
    backendConfigured,
    recordActivity,
  } = useEv();
  const [phase, setPhase] = useState<VoicePhase>("ready");
  const [linkMode, setLinkMode] = useState<LinkMode>("realtime");
  const [linkPhase, setLinkPhase] = useState<RealtimePhase | null>(null);
  const [lines, setLines] = useState<TranscriptLine[]>([]);
  const [interim, setInterim] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [micStream, setMicStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [muted, setMuted] = useState(false);
  const [rateLimits, setRateLimits] = useState<RealtimeRateLimit[]>([]);
  const [recording, setRecording] = useState(false);
  /** E.V.'s audio is flowing yet: "waiting" = recorder
   * armed but she has not spoken; "capturing" = her
   * voice is being captured. */
  const [recState, setRecState] = useState<"waiting" | "capturing">("waiting");
  /** Realtime-path capture unsupported in this browser. */
  const [recUnsupported, setRecUnsupported] = useState(false);
  const [recElapsed, setRecElapsed] = useState(0);
  const [savingRecording, setSavingRecording] = useState(false);
  const [savedTick, setSavedTick] = useState(0);
  const [saved, setSaved] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [hasPendingTurn, setHasPendingTurn] = useState(false);
  const recogRef = useRef<SpeechRecognitionLike | null>(null);
  const realtimeRef = useRef<RealtimeHandle | null>(null);
  const recorderRef = useRef<SessionRecorder | null>(null);
  /** Transcript-line count when the current capture segment began,
   * so a saved segment is titled from its own first user line. */
  const segmentStartRef = useRef(0);
  const streamRef = useRef<MediaStream | null>(null);
  const linesRef = useRef<TranscriptLine[]>([]);
  const interimAssistant = useRef("");
  /** Mirrors linkMode so the auto-trigger effect can read it without re-render. */
  const linkModeRef = useRef<LinkMode>("realtime");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioRef = useRef<{
    ctx: AudioContext;
    analyser: AnalyserNode;
    raf: number;
  } | null>(null);
  const playbackRef = useRef<{
    ctx: AudioContext;
    analyser: AnalyserNode;
    raf: number;
    audio: HTMLAudioElement;
  } | null>(null);
  const silenceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const pendingUserTurnRef = useRef<string>("");
  const isTurnInFlightRef = useRef(false);
  const aliveRef = useRef(true);
  const reduced = !motionAllowed(settings.reducedMotionOverride);
  // ACTIVE voice: which group is selected plus the exact id sent to TTS.
  const activeVoice = resolveActiveVoice(settings);
  const fishVoices = savedFishVoices(settings);
  const openRouterKey = (settings.openRouterApiKey ?? "").trim();

  // Keep references to state values needed inside callbacks
  const activeIdRef = useRef(activeId);
  const settingsRef = useRef(settings);
  const memoriesRef = useRef(memories);
  const notesRef = useRef(notes);
  const convIdRef = useRef<string | null>(null);
  const persistedRef = useRef(0);

  useEffect(() => {
    activeIdRef.current = activeId;
    settingsRef.current = settings;
    memoriesRef.current = memories;
    notesRef.current = notes;
    convIdRef.current = activeId;
  }, [activeId, settings, memories, notes]);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const stopPlayback = useCallback(() => {
    if (playbackRef.current) {
      cancelAnimationFrame(playbackRef.current.raf);
      playbackRef.current.audio.pause();
      playbackRef.current.audio.src = "";
      void playbackRef.current.ctx.close().catch(() => undefined);
      playbackRef.current = null;
    }
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    if (aliveRef.current) {
      setIsSpeaking(false);
    }
  }, []);

  const teardown = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    pendingUserTurnRef.current = "";
    setHasPendingTurn(false);
    isTurnInFlightRef.current = false;


    stopPlayback();

    recorderRef.current?.dispose();
    recorderRef.current = null;

    if (realtimeRef.current) {
      try {
        realtimeRef.current.stop();
      } catch {
        /* ignore */
      }
      realtimeRef.current = null;
    }
    if (recogRef.current) {
      try {
        recogRef.current.onend = null;
        recogRef.current.stop();
      } catch {
        /* already stopped */
      }
      recogRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (audioRef.current) {
      cancelAnimationFrame(audioRef.current.raf);
      void audioRef.current.ctx.close().catch(() => undefined);
      audioRef.current = null;
    }
    setMicStream(null);
    setRemoteStream(null);
    setRecording(false);
    setRecState("waiting");
    setRecUnsupported(false);
    setRecElapsed(0);
    setSavingRecording(false);
    setIsProcessing(false);
    setMuted(false);
    setRateLimits([]);
  }, [stopPlayback]);

  /** Arm the session recorder. Nothing is captured until
   * E.V. speaks: the realtime path starts when the link
   * delivers her remote track, the local path when the
   * first spoken reply arrives. */
  const startSessionRecording = useCallback(() => {
    recorderRef.current = new SessionRecorder();
    setRecording(true);
    setRecState("waiting");
    setRecUnsupported(false);
    setRecElapsed(0);
  }, []);

  // Elapsed-time readout for the recording indicator:
  // wall-clock for the realtime recorder, summed reply
  // durations for the local-tts buffer.
  useEffect(() => {
    if (recState !== "capturing") return;
    const timer = window.setInterval(() => {
      setRecElapsed(recorderRef.current?.elapsedSec ?? 0);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [recState]);

  useEffect(() => teardown, [teardown]);

  const drawWave = useCallback((analyser: AnalyserNode) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx2d = canvas.getContext("2d");
    if (!ctx2d) return;
    const data = new Uint8Array(analyser.fftSize);
    const render = () => {
      analyser.getByteTimeDomainData(data);
      ctx2d.clearRect(0, 0, canvas.width, canvas.height);
      ctx2d.strokeStyle = "#35e0ff";
      ctx2d.lineWidth = 1.5;
      ctx2d.beginPath();
      const step = canvas.width / data.length;
      data.forEach((v, i) => {
        const y =
          ((v - 128) / 128) * (canvas.height / 2 - 4) + canvas.height / 2;
        if (i === 0) ctx2d.moveTo(0, y);
        else ctx2d.lineTo(i * step, y);
      });
      ctx2d.stroke();
      if (audioRef.current) {
        audioRef.current.raf = requestAnimationFrame(render);
      }
    };
    render();
  }, []);

  const attachWaveform = useCallback(
    (stream: MediaStream) => {
      if (reduced) return;
      try {
        const AudioCtx =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = new AudioCtx();
        const src = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        src.connect(analyser);
        audioRef.current = { ctx, analyser, raf: 0 };
        if (canvasRef.current) {
          canvasRef.current.width = 420;
          canvasRef.current.height = 64;
          drawWave(analyser);
        }
      } catch {
        /* waveform is decorative; the session continues */
      }
    },
    [drawWave, reduced],
  );

  const pushFinal = useCallback(
    (speaker: "user" | "assistant", text: string, interrupted = false) => {
      const clean = text.trim();
      if (!clean) return;
      linesRef.current = [...linesRef.current, { speaker, text: clean, interrupted }];
      setLines([...linesRef.current]);
    },
    [],
  );

  /**
   * One turn, one history entry. Voice and text share the same conversation,
   * so switching links never splits or duplicates the thread.
   */
  const persistTurn = useCallback(
    async (speaker: "user" | "assistant", text: string) => {
      const clean = text.trim();
      if (!clean || !settingsRef.current.transcriptPersistence) return;
      let convId = convIdRef.current;
      if (!convId) {
        convId = await newConversation();
        convIdRef.current = convId;
      }
      if (!convId) return;
      await appendMessage(convId, {
        id: newId("msg"),
        role: speaker,
        content: clean,
        createdAt: Date.now(),
      });
      persistedRef.current += 1;
      if (aliveRef.current) setSaved(true);
    },
    [appendMessage, newConversation],
  );

  /**
   * Play assistant speech with live amplitude extraction for the orb.
   */
  const playAssistantSpeech = useCallback(
    async (text: string): Promise<void> => {
      if (!aliveRef.current) return;
      stopPlayback();
      setIsSpeaking(true);
      setCoreState("speaking");

      try {
        // Speak with the voice the owner picked in Settings (or on this page).
        // Free selection sends the Edge Neural id on the free path; a Fish
        // selection sends provider "openrouter-fish" + its model id. Provider-
        // appropriate keys are forwarded only when actually configured.
        const s = settingsRef.current;
        const active = resolveActiveVoice(s);
        const fishKey = s.fishAudioApiKey?.trim() || "";
        const elevenKey = s.elevenLabsApiKey?.trim() || "";
        const elevenVoiceId = s.elevenLabsVoiceId?.trim() || "";
        const azureKey = s.azureSpeechKey?.trim() || "";
        const azureRegion = s.azureSpeechRegion?.trim() || "";
        const fishOrActive = active.source === "openrouter-fish";
        // On the free side the optional premium keys keep their precedence.
        const elevenActive = !fishOrActive && Boolean(elevenKey && elevenVoiceId);
        const azureActive = !fishOrActive && !elevenActive && Boolean(azureKey && azureRegion);
        const { blob: audioBlob, voice: spokenVoice, provider } = await speakText(text, {
          ...speakOptionsForVoice(active, s),
          ...(!fishOrActive && fishKey ? { apiKey: fishKey } : {}),
          ...(elevenActive ? { provider: "elevenlabs" as const, elevenKey, elevenVoiceId } : {}),
          ...(azureActive ? { provider: "azure" as const, azureKey, azureRegion } : {}),
          allowFallback: true,
        });
        // Tee E.V.'s spoken reply into the session
        // recording (local-tts path: her voice is the
        // TTS audio itself, not the microphone).
        recorderRef.current?.appendReply(audioBlob);
        if (aliveRef.current) {
          setRecState("capturing");
        }
        if (provider && provider !== "fish-audio" && fishKey && aliveRef.current) {
          setNotice(
            "Premium voice is temporarily unavailable — spoke with the free voice instead.",
          );
        } else if (provider && fishOrActive && provider !== "openrouter-fish" && aliveRef.current) {
          setNotice(
            "Fish via OpenRouter is busy right now — spoke with the free voice instead. Your transcript is preserved.",
          );
        } else if (spokenVoice && fishOrActive && spokenVoice !== active.id && aliveRef.current) {
          setNotice(`Spoke with ${spokenVoice} (requested ${active.id}).`);
        } else if (spokenVoice && active.id && spokenVoice !== active.id && aliveRef.current) {
          setNotice(`Spoke with ${spokenVoice} (requested ${active.id}).`);
        }
        const audioUrl = URL.createObjectURL(audioBlob);
        const win = window as Window & typeof globalThis & {
          webkitAudioContext?: typeof AudioContext;
        };
        const AudioCtx = win.AudioContext ?? win.webkitAudioContext;
        if (!AudioCtx) {
          throw new Error("AudioContext not supported");
        }

        const audioCtx = new AudioCtx();
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 512;
        analyser.smoothingTimeConstant = 0.8;

        const audioEl = new Audio();
        audioEl.src = audioUrl;
        audioEl.crossOrigin = "anonymous";

        const sourceNode = audioCtx.createMediaElementSource(audioEl);
        sourceNode.connect(analyser);
        analyser.connect(audioCtx.destination);

        playbackRef.current = {
          ctx: audioCtx,
          analyser,
          raf: 0,
          audio: audioEl,
        };

        await audioCtx.resume();

        await new Promise<void>((resolve) => {
          audioEl.onended = () => {
            URL.revokeObjectURL(audioUrl);
            resolve();
          };
          audioEl.onerror = () => {
            URL.revokeObjectURL(audioUrl);
            resolve();
          };
          void audioEl.play().catch(() => resolve());
        });
      } catch (err) {
        console.warn("TTS audio playback failed:", err);
        if (aliveRef.current) {
          const code = err instanceof BackendUnavailableError ? err.code : undefined;
          const fishKeyInUse = (settingsRef.current.fishAudioApiKey?.trim() ?? "").length > 0;
          const elevenInUse =
            (settingsRef.current.elevenLabsApiKey?.trim() ?? "").length > 0 &&
            (settingsRef.current.elevenLabsVoiceId?.trim() ?? "").length > 0;
          const azureInUse =
            (settingsRef.current.azureSpeechKey?.trim() ?? "").length > 0 &&
            (settingsRef.current.azureSpeechRegion?.trim() ?? "").length > 0;
          const fishOrInUse =
            (settingsRef.current.fishVoiceViaOpenRouter?.trim() ?? "").length > 0 &&
            (settingsRef.current.fishAudioApiKey?.trim() ?? "").length === 0;
          // Only mention keys/top-up when billing failed AND a keyed provider
          // was actually in use. Free-path failures say retry/wait instead.
          if ((code === "billing_required" || code === "payment_required") && (fishKeyInUse || elevenInUse || azureInUse)) {
            setNotice(
              "Premium voice is out of credits — nothing was spoken. Retry in a moment, or clear the voice key in Settings to use free voices. The transcript above is preserved.",
            );
          } else if (code === "invalid_credentials" && fishOrInUse) {
            setNotice(
              "The Fish-via-OpenRouter voice was rejected — check your OpenRouter key in Settings (a Fish voice id needs no Fish Audio key). Nothing was spoken — the transcript above is preserved.",
            );
          } else if (code === "invalid_credentials" && (elevenInUse || azureInUse)) {
            setNotice(
              "The saved voice key was rejected — check it in Settings (Voice section), or clear it to use free voices. Nothing was spoken — the transcript above is preserved.",
            );
          } else if (code === "rate_limited") {
            setNotice(
              fishOrInUse
                ? "The free Fish model on OpenRouter is rate-limited — wait ~30s, then use Send speech turn to retry. The transcript above is preserved."
                : "Voice synthesis is rate-limited — wait ~30s, then use Send speech turn to retry. The transcript above is preserved.",
            );
          } else if (code === "setup_required" && fishOrInUse) {
            setNotice(
              "Fish via OpenRouter needs an OpenRouter key — add it in Settings, then retry. No Fish Audio key is required. The transcript above is preserved.",
            );
          } else {
            const message =
              err instanceof Error && err.message
                ? err.message
                : "Speech synthesis is unavailable.";
            const hint = err instanceof BackendUnavailableError ? err.hint : "";
            setNotice(hint ? `${message} ${hint} Nothing was spoken — the transcript above is preserved.` : `${message} Nothing was spoken — wait a moment and retry. The transcript above is preserved.`);
          }
        }
      } finally {
        stopPlayback();
        if (aliveRef.current) {
          setCoreState("listening");
        }
      }
    },
    [setCoreState, stopPlayback],
  );

  /**
   * Execute an AI response turn in local mode.
   */
  const handleResponseTurn = useCallback(
    async (userInput: string) => {
      const cleanInput = userInput.trim();
      if (!cleanInput || isTurnInFlightRef.current || !aliveRef.current) return;

      isTurnInFlightRef.current = true;
      setIsProcessing(true);
      setCoreState("processing");

      // Stop recognition while AI thinks & speaks to avoid echoing back
      if (recogRef.current) {
        try {
          recogRef.current.stop();
        } catch {
          /* ignore */
        }
      }

      pushFinal("user", cleanInput);
      await persistTurn("user", cleanInput);

      try {
        const currentSettings = settingsRef.current;
        const currentMemories = memoriesRef.current;
        const currentNotes = notesRef.current;

        // Build history from lines + context
        const history: ChatPayloadMessage[] = [];
        const enabledMemories = currentSettings.memoryEnabled
          ? currentMemories.filter((m) => m.enabled)
          : [];

        if (enabledMemories.length > 0) {
          history.push({
            role: "system",
            content: `User-approved memories (respect, keep answers conversational and concise for voice):\n${enabledMemories
              .map((m) => `- ${m.text}`)
              .slice(0, 8)
              .join("\n")}`,
          });
        }

        // Tail of conversation lines
        const recentLines = linesRef.current.slice(-10);
        for (const line of recentLines) {
          history.push({
            role: line.speaker === "assistant" ? "assistant" : "user",
            content: line.text,
          });
        }

        const streamRes = await postChatStream(history, {
          apiKey: currentSettings.openRouterApiKey || undefined,
          model: currentSettings.openRouterModel || undefined,
          extra: {
            conversationId: convIdRef.current ?? undefined,
            notes: currentNotes.slice(0, 50).map((n) => ({
              id: n.id,
              title: n.title.slice(0, 500),
              body: n.body.slice(0, 20000),
            })),
            memories: enabledMemories
              .slice(0, 8)
              .map((m) => ({ text: m.text.slice(0, 4000), enabled: true })),
          },
        });

        const answerText = (streamRes.text || "").trim();
        if (answerText && aliveRef.current) {
          pushFinal("assistant", answerText);
          await persistTurn("assistant", answerText);

          await recordActivity("voice", "E.V. spoken response delivered");

          // Play audio response with live amplitude
          await playAssistantSpeech(answerText);
        }
      } catch (err) {
        console.error("AI voice response failed:", err);
        const code = err instanceof BackendUnavailableError ? err.code : undefined;
        const errMsg =
          code === "rate_limited"
            ? "Chat provider is rate-limited — wait ~30s and use Send speech turn to retry, or switch to a lighter model in Settings."
            : code === "setup_required"
              ? "Chat is not configured — add your OpenRouter key in Settings, then use Send speech turn to retry."
              : "I ran into a problem responding. Please check settings or try again.";
        if (aliveRef.current) {
          pushFinal("assistant", errMsg);
          setNotice(code === "rate_limited" ? errMsg : null);
          await playAssistantSpeech(errMsg);
        }
      } finally {
        if (aliveRef.current) {
          setIsProcessing(false);
          isTurnInFlightRef.current = false;
          setCoreState("listening");

          // Resume microphone listening for user's next turn
          if (recogRef.current) {
            try {
              recogRef.current.start();
            } catch {
              /* ignore */
            }
          }
        }
      }
    },
    [
      persistTurn,
      playAssistantSpeech,
      pushFinal,
      recordActivity,
      setCoreState,
    ],
  );

  /**
   * Trigger silence timer debounce (1.5s after user stops speaking).
   */
  const scheduleUserTurn = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
    }
    silenceTimerRef.current = setTimeout(() => {
      silenceTimerRef.current = null;
      const turnText = pendingUserTurnRef.current.trim();
      if (turnText && !isTurnInFlightRef.current) {
        pendingUserTurnRef.current = "";
        setHasPendingTurn(false);
        void handleResponseTurn(turnText);
      }
    }, 1500);
  }, [handleResponseTurn]);

  /** Labelled fallback: on-device dictation with conversational AI loop. */
  const startLocalDictation = useCallback(
    (stream: MediaStream) => {
      const Recognizer = getRecognizer();
      if (!Recognizer) {
        teardown();
        if (aliveRef.current) {
          setPhase("unsupported");
          setCoreState("disconnected");
        }
        return;
      }
      attachWaveform(stream);
      const recog = new Recognizer();
      recog.continuous = true;
      recog.interimResults = true;
      recog.lang = "en-US";

      recog.onresult = (event) => {
        let interimText = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          if (!result) continue;
          const piece = result[0]?.transcript ?? "";
          if (result.isFinal) {
            pushFinal("user", piece);
            pendingUserTurnRef.current = (
              pendingUserTurnRef.current +
              " " +
              piece
            ).trim();
            setHasPendingTurn(Boolean(pendingUserTurnRef.current));
            // Start silence debounce when user finishes a phrase
            scheduleUserTurn();
          } else {
            interimText += piece;
            // Clear timer while user is actively speaking interim words
            if (silenceTimerRef.current) {
              clearTimeout(silenceTimerRef.current);
              silenceTimerRef.current = null;
            }
          }
        }
        setInterim(interimText);
      };

      recog.onerror = (event) => {
        if (
          event.error === "not-allowed" ||
          event.error === "service-not-allowed"
        ) {
          teardown();
          if (aliveRef.current) {
            setPhase("denied");
            setCoreState("disconnected");
          }
        }
      };

      recog.onend = () => {
        // Only restart if not currently speaking or processing AI response
        if (
          recogRef.current &&
          !isTurnInFlightRef.current &&
          aliveRef.current
        ) {
          try {
            recog.start();
          } catch {
            /* session ending elsewhere */
          }
        }
      };

      recogRef.current = recog;
      try {
        recog.start();
        setPhase("live");
        setLinkMode("local");
        linkModeRef.current = "local";
        setCoreState("listening");
      } catch {
        teardown();
      }
    },
    [
      attachWaveform,
      pushFinal,
      scheduleUserTurn,
      setCoreState,
      teardown,
    ],
  );

  /** Mint a session; shared by the first connect and every renewal. */
  const mintSession = useCallback(async (): Promise<{
    clientSecret: string;
    realtimeUrl: string;
    expiresAt?: number;
    dataChannelName?: string;
  }> => {
    const history = (active?.messages ?? [])
      .slice(-10)
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));
    const approved = settingsRef.current.memoryEnabled
      ? memoriesRef.current
          .filter((m) => m.enabled)
          .slice(0, 8)
          .map((m) => ({ text: m.text.slice(0, 4000) }))
      : [];
    const session: VoiceSessionPayload = await createVoiceSession(history, approved);
    return {
      clientSecret: session.clientSecret,
      realtimeUrl: session.realtimeUrl,
      expiresAt: session.expiresAt,
      dataChannelName: session.webrtc?.dataChannel ?? "oai-events",
    };
  }, [active]);

  const begin = useCallback(async () => {
    setSaved(false);
    setNotice(null);
    setPhase("requesting");
    setCoreState("connecting");

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      if (aliveRef.current) {
        setPhase("denied");
        setCoreState("disconnected");
      }
      return;
    }
    streamRef.current = stream;
    setMicStream(stream);
    linesRef.current = [];
    interimAssistant.current = "";
    pendingUserTurnRef.current = "";
    persistedRef.current = 0;
    convIdRef.current = activeIdRef.current;
    setHasPendingTurn(false);
    setLines([]);
    setInterim("");
    setLinkPhase("connecting");
    segmentStartRef.current = 0;
    startSessionRecording();

    attachWaveform(stream);
    try {
      const handle = await startRealtimeSession({
        mint: mintSession,
        stream,
        onTranscript: (text, final, speaker = "assistant") => {
          if (!aliveRef.current) return;
          if (final) {
            pushFinal(speaker, text);
            setInterim("");
            interimAssistant.current = "";
            void persistTurn(speaker, text);
          } else if (speaker === "assistant") {
            interimAssistant.current += text;
            setInterim(interimAssistant.current);
          } else {
            setInterim(text);
          }
        },
        onInterruption: (partial) => {
          if (!aliveRef.current) return;
          // A cut-off answer is a fragment, never a finished reply.
          pushFinal("assistant", `${partial} …`, true);
          interimAssistant.current = "";
          setInterim("");
        },
        onState: (next, detail) => {
          if (!aliveRef.current) return;
          setLinkPhase(next);
          setCoreState(REALTIME_TO_CORE[next]);
          setIsSpeaking(next === "speaking");
          setIsProcessing(next === "processing");
          if (detail && next !== "ended") setNotice(detail);
          if (next === "error" && detail) {
            setIsSpeaking(false);
            setIsProcessing(false);
          }
        },
        onRemoteStream: (remote) => {
          const recorder = recorderRef.current;
          if (recorder) {
            if (recorder.attachRemote(remote)) {
              if (aliveRef.current) {
                setRecState("capturing");
              }
            } else if (aliveRef.current) {
              setRecUnsupported(true);
            }
          }
          if (aliveRef.current) setRemoteStream(remote);
        },
        onRateLimits: (limits) => {
          if (aliveRef.current) setRateLimits(limits);
        },
      });
      realtimeRef.current = handle;
      if (aliveRef.current) {
        setLinkMode("realtime");
        linkModeRef.current = "realtime";
        setPhase("live");
        setNotice(null);
        await recordActivity("voice", "Hands-free realtime voice session started");
      }
    } catch (error) {
      if (aliveRef.current) {
        setNotice(
          error instanceof Error
            ? `${error.message} Falling back to local dictation + chat + speech synthesis.`
            : "Realtime voice link unavailable. Falling back to local dictation.",
        );
      }
      startLocalDictation(stream);
    }
  }, [
    activeIdRef,
    attachWaveform,
    mintSession,
    persistTurn,
    pushFinal,
    recordActivity,
    setCoreState,
    startLocalDictation,
    startSessionRecording,
  ]);

  const end = useCallback(async () => {
    setPhase("ending");
    setCoreState("processing");
    const turns = linesRef.current.length;
    const persisted = persistedRef.current;
    teardown();
    setLinkPhase(null);
    if (persisted > 0) {
      await recordActivity(
        "voice",
        "Voice conversation saved to history",
        `${persisted} turns of ${turns} transcript lines`,
      );
    }
    if (aliveRef.current) {
      setCoreState(backendConfigured ? "idle" : "disconnected");
      setPhase("ready");
    }
  }, [backendConfigured, recordActivity, setCoreState, teardown]);

  /** Persist the audio captured so far as a recording, then
   * start a fresh capture segment so the session can yield
   * more than one saved recording. */
  const handleSaveRecording = useCallback(async () => {
    const recorder = recorderRef.current;
    if (!recorder || savingRecording) return;
    setSavingRecording(true);
    try {
      const segment = await recorder.snapshot();
      if (!segment) {
        if (aliveRef.current) {
          setNotice(
            "Nothing captured yet — E.V. has not spoken. Wait for her to answer, then save again.",
          );
        }
        return;
      }
      const recording: Recording = {
        id: newId("rec"),
        title: recordingTitle(linesRef.current, segmentStartRef.current),
        source: segment.source,
        createdAt: Date.now(),
        durationSec: segment.durationSec,
        mimeType: segment.mimeType,
        sizeBytes: segment.blob.size,
        blob: segment.blob,
      };
      await saveRecording(recording);
      segmentStartRef.current = linesRef.current.length;
      setSavedTick((tick) => tick + 1);
      if (aliveRef.current) {
        setNotice(
          `Recording saved — ${formatDurationSec(segment.durationSec)} of E.V.'s voice (${
            segment.source === "realtime" ? "realtime link" : "text-to-speech"
          }). Capture continues into a new segment.`,
        );
        void recordActivity(
          "voice",
          "Voice recording saved",
          `${formatDurationSec(segment.durationSec)} · ${segment.source} · ${recording.sizeBytes} bytes`,
        );
      }
    } catch (error) {
      if (aliveRef.current) {
        setNotice(
          error instanceof PersistenceError
            ? error.message
            : "The recording was not saved — storage failed. Try deleting old recordings, then save again.",
        );
      }
    } finally {
      setSavingRecording(false);
    }
  }, [recordActivity, savingRecording]);

  /** Manual interrupt or send trigger */
  const handleManualSend = useCallback(() => {
    if (isTurnInFlightRef.current) return;
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    const text = (pendingUserTurnRef.current || interim).trim();
    if (text) {
      pendingUserTurnRef.current = "";
      setHasPendingTurn(false);
      setInterim("");
      void handleResponseTurn(text);
    }
  }, [handleResponseTurn, interim]);

  const handleInterrupt = useCallback(() => {
    if (realtimeRef.current) {
      realtimeRef.current.interrupt();
      return;
    }
    stopPlayback();
    if (aliveRef.current) {
      setCoreState("listening");
      if (recogRef.current) {
        try {
          recogRef.current.start();
        } catch {
          /* ignore */
        }
      }
    }
  }, [setCoreState, stopPlayback]);

  /** Mute/unmute the outgoing mic track; the session stays hot. */
  const handleMute = useCallback(() => {
    const handle = realtimeRef.current;
    if (!handle) return;
    const next = !muted;
    handle.setMicEnabled(!next);
    setMuted(next);
    if (aliveRef.current) {
      setNotice(
        next
          ? "Microphone muted — E.V. keeps listening to the room. Unmute to talk again."
          : "Microphone live again — speak whenever you like.",
      );
    }
  }, [muted]);

  // Auto-start voice and hand the wake-word query to the live link (?auto=1&q=...)
  const autoTriggeredRef = useRef(false);
  useEffect(() => {
    if (autoTriggeredRef.current) return;
    if (searchParams.get("auto") !== "1") return;
    autoTriggeredRef.current = true;
    void (async () => {
      await begin();
      const q = searchParams.get("q")?.trim();
      if (!q || !aliveRef.current) return;
      if (linkModeRef.current === "realtime" && realtimeRef.current) {
        // Realtime link: inject the question as a real user turn; the answer
        // flows back through the same data-channel transcript path as speech.
        pushFinal("user", q);
        void persistTurn("user", q);
        realtimeRef.current.sendUserText(q);
      } else {
        void handleResponseTurn(q);
      }
    })();
  }, [searchParams, begin, pushFinal, persistTurn, handleResponseTurn]);

  const livePhase = phase === "live" ? (linkPhase ?? "live") : null;
  const tokensLeft = rateLimits.find((r) => r.name === "tokens")?.remaining;
  const rateLimited = typeof tokensLeft === "number" && tokensLeft <= 0;
  const stageLabel =
    phase !== "live"
      ? "DITHERED ORB · STANDBY"
      : linkMode === "realtime" && livePhase
        ? `DITHERED ORB · ${LINK_LABEL[livePhase].toUpperCase()}`
        : isSpeaking
          ? "DITHERED ORB · E.V. SPEAKING"
          : isProcessing
            ? "DITHERED ORB · PROCESSING TURN"
            : "DITHERED ORB · LISTENING";

  return (
    <div className="ev-stack">
      <header className="ev-page-head">
        <SectionLabel>E.V. // Voice Mode</SectionLabel>
        <h1 className="ev-h1">Voice link</h1>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {phase === "live" ? (
            <StatusPill tone="ok">Session · Live</StatusPill>
          ) : phase === "requesting" || phase === "ending" ? (
            <StatusPill tone="warn">Session · {phase}</StatusPill>
          ) : (
            <StatusPill tone="mute">Session · Standby</StatusPill>
          )}
          {phase === "live" &&
            (linkMode === "realtime" ? (
              <StatusPill tone="ok">Realtime · Hands-free</StatusPill>
            ) : (
              <StatusPill tone="warn">Conversational local · Active</StatusPill>
            ))}
          {muted && <StatusPill tone="warn">Mic muted</StatusPill>}
          {rateLimited && (
            <StatusPill tone="bad">Rate limit reached</StatusPill>
          )}
          <CloudPill />
        </div>

        {/* Voice chooser — switch the ACTIVE E.V. voice while talking */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
            marginTop: 10,
            paddingTop: 10,
            borderTop: "1px solid var(--color-ev-line)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              flexWrap: "wrap",
            }}
          >
            <span
              style={{
                fontSize: 12,
                color: "var(--color-ev-muted)",
                display: "flex",
                alignItems: "center",
                gap: 4,
                marginRight: 4,
              }}
            >
              <Volume2 style={{ width: 13, height: 13, color: "#35e0ff" }} /> Voice:
            </span>
            <span style={{ fontSize: 11.5, color: "var(--color-ev-muted)" }}>
              the one badged <strong style={{ color: "#35e0ff" }}>ACTIVE</strong> is what E.V.
              speaks with
            </span>
          </div>

          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            {[
              { id: "", name: "Auto", title: "Server free default voice — no setup needed" },
              ...FREE_VOICE_OPTIONS.map((v) => ({
                id: v.id,
                name: v.name,
                title: `${v.id} (free — no key needed)`,
              })),
            ].map((v) => {
              const isActive = activeVoice.source === "free" && activeVoice.id === v.id;
              return (
                <button
                  key={v.id || "auto"}
                  type="button"
                  aria-pressed={isActive}
                  onClick={() => {
                    void setTtsVoice(v.id);
                    void setActiveVoiceSource("free");
                    void recordActivity("voice", v.id ? `Voice changed to ${v.name} (${v.id})` : "Voice changed to Auto (server free default)");
                  }}
                  title={v.title}
                  style={{
                    fontSize: 11.5,
                    padding: "3px 9px",
                    borderRadius: 9999,
                    border: isActive
                      ? "1px solid #35e0ff"
                      : "1px solid var(--color-ev-line)",
                    background: isActive
                      ? "rgba(53, 224, 255, 0.15)"
                      : "rgba(255, 255, 255, 0.03)",
                    color: isActive ? "#35e0ff" : "var(--color-ev-muted)",
                    cursor: "pointer",
                    fontWeight: isActive ? 600 : 400,
                    transition: "all 0.15s ease",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 5,
                  }}
                >
                  <span>{v.name}</span>
                  {isActive && <ActiveBadge />}
                </button>
              );
            })}

            {fishVoices.length > 0 && (
              <>
                <span
                  aria-hidden="true"
                  style={{ fontSize: 11, color: "var(--color-ev-muted)", margin: "0 2px" }}
                >
                  |
                </span>
                {fishVoices.map((id, index) => {
                  const isActive = activeVoice.source === "openrouter-fish" && activeVoice.id === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      aria-pressed={isActive}
                      onClick={() => {
                        void setFishVoiceViaOpenRouter(id);
                        void setActiveVoiceSource("openrouter-fish");
                        void recordActivity(
                          "voice",
                          `Voice changed to ${fishVoiceLabel(index)} (Fish via OpenRouter, ${id})`,
                        );
                      }}
                      title={`${fishVoiceLabel(index)} — ${id} (Fish via OpenRouter)`}
                      style={{
                        fontSize: 11.5,
                        padding: "3px 9px",
                        borderRadius: 9999,
                        border: isActive
                          ? "1px solid #35e0ff"
                          : "1px solid var(--color-ev-line)",
                        background: isActive
                          ? "rgba(53, 224, 255, 0.15)"
                          : "rgba(255, 255, 255, 0.03)",
                        color: isActive ? "#35e0ff" : "var(--color-ev-muted)",
                        cursor: "pointer",
                        fontWeight: isActive ? 600 : 400,
                        fontFamily: "var(--font-geist-mono), monospace",
                        transition: "all 0.15s ease",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 5,
                      }}
                    >
                      <span>
                        {fishVoiceLabel(index)} · {truncateId(id, 10)}
                      </span>
                      {isActive && <ActiveBadge />}
                    </button>
                  );
                })}
              </>
            )}
          </div>

          {activeVoice.source === "openrouter-fish" && !openRouterKey && (
            <p
              role="status"
              style={{
                fontSize: 11.5,
                color: "#ffd479",
                margin: 0,
                lineHeight: 1.5,
              }}
            >
              Fish voice selected, but no OpenRouter key is saved in this browser
              — add your OpenRouter key in Settings to use Fish voices. E.V. may
              still fall back to a server .env key; otherwise replies drop to the
              free voice.
            </p>
          )}

          {fishVoices.length === 0 && (
            <p
              role="status"
              style={{ fontSize: 11.5, color: "var(--color-ev-muted)", margin: 0, lineHeight: 1.5 }}
            >
              No Fish voices saved. Add one in Settings → Voice: paste the hex voice
              model id from the OpenRouter playground and press Add voice.
            </p>
          )}
        </div>
      </header>

      <section className="ev-panel ev-voice-stage" aria-label="Voice stage">
        <div
          style={{
            position: "relative",
            width: "100%",
            maxWidth: 580,
            flex: 1,
            minHeight: 380,
            borderRadius: 16,
            overflow: "hidden",
            border: "1px solid var(--color-ev-line)",
            background: "#000",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            role="button"
            tabIndex={0}
            aria-label={
              phase === "live"
                ? "End voice session"
                : "Enable microphone and start session"
            }
            onClick={phase === "live" ? () => void end() : () => void begin()}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                if (phase === "live") void end();
                else void begin();
              }
            }}
            className="absolute inset-0 cursor-pointer"
          >
            <VoicePoweredOrb
              className="w-full h-full"
              hue={187}
              enableVoiceControl={phase === "live"}
            />
          </div>

          <div
            style={{
              position: "absolute",
              top: 14,
              left: 16,
              zIndex: 20,
              pointerEvents: "none",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <span
              className={`ev-dot ev-dot-${
                phase === "live"
                  ? linkPhase === "error"
                    ? "bad"
                    : linkPhase === "speaking" || isSpeaking
                      ? "ok"
                      : linkPhase === "renewing" || isProcessing
                        ? "warn"
                        : "ok"
                  : phase === "requesting"
                    ? "warn"
                    : "mute"
              }`}
            />
            <span
              style={{
                fontSize: 11,
                fontFamily: "var(--font-geist-mono), monospace",
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: "var(--color-ev-muted)",
              }}
            >
              {stageLabel}
            </span>
          </div>

          {phase === "ready" && (
            <div
              style={{
                position: "absolute",
                bottom: 18,
                zIndex: 20,
                pointerEvents: "none",
                textAlign: "center",
              }}
            >
              <span
                style={{
                  fontSize: 11.5,
                  color: "rgba(255, 255, 255, 0.65)",
                  fontFamily: "var(--font-geist-mono), monospace",
                }}
              >
                Tap center orb or button below to initiate voice link
              </span>
            </div>
          )}
        </div>

        {phase === "live" && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 6,
              marginTop: 10,
              maxWidth: 520,
            }}
            aria-label="Live audio levels"
          >
            <LevelMeter
              stream={micStream}
              label={muted ? "Mic (muted)" : "Mic input"}
              tone="in"
            />
            {linkMode === "realtime" && (
              <LevelMeter
                stream={remoteStream}
                label={isSpeaking ? "E.V. output" : "E.V. output (idle)"}
                tone="out"
              />
            )}
          </div>
        )}

        {!reduced && (
          <canvas
            ref={canvasRef}
            className="ev-wave"
            aria-hidden="true"
            style={{ opacity: phase === "live" ? 0.9 : 0.2 }}
          />
        )}
        {phase === "ready" && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 10,
              alignItems: "center",
            }}
          >
            <button
              type="button"
              className="ev-btn ev-btn-primary"
              onClick={() => void begin()}
            >
              <Mic /> Enable microphone & start
            </button>
            <p className="ev-hint" style={{ maxWidth: 52 * 8 }}>
              One click, then hands-free: the microphone stays hot for the whole
              conversation. Speak, E.V. answers, speak again — and talk over
              E.V. to cut an answer short. Context syncs from the active text
              thread{active ? ` (“${active.title}”)` : ""} plus approved memories,
              and every turn is written into that same thread.
            </p>
          </div>
        )}

        {phase === "requesting" && (
          <p className="ev-hint">
            Requesting microphone permission and establishing voice link…
          </p>
        )}

        {phase === "live" && (
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <button
              type="button"
              className="ev-btn ev-btn-danger"
              onClick={() => void end()}
            >
              <PhoneOff /> End session
            </button>

            <button
              type="button"
              className="ev-btn"
              onClick={() => void handleSaveRecording()}
              disabled={recState !== "capturing" || savingRecording}
              title={
                recUnsupported
                  ? "Audio capture is not supported in this browser"
                  : recState === "capturing"
                    ? "Save E.V.'s voice captured so far — capture continues into a new segment"
                    : recording
                      ? "Waiting for E.V.'s voice — the recording starts when she speaks"
                      : "Start a voice session to record E.V.'s voice"
              }
            >
              <Save size={14} /> {savingRecording ? "Saving…" : "Save recording"}
            </button>

            {recState === "capturing" && (
              <span
                className="ev-hint ev-mono"
                role="status"
                style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
              >
                <span className="ev-dot ev-dot-bad" aria-hidden="true" />
                REC {formatDurationSec(recElapsed)} · {REC_LABEL}
              </span>
            )}

            {linkMode === "realtime" ? (
              <>
                <button
                  type="button"
                  className="ev-btn"
                  onClick={handleMute}
                  aria-pressed={muted}
                  title={muted ? "Unmute the microphone" : "Mute the microphone, keep the session live"}
                >
                  {muted ? <MicOff size={14} /> : <Mic size={14} />}
                  {muted ? "Unmute mic" : "Mute mic"}
                </button>
                <button
                  type="button"
                  className="ev-btn"
                  onClick={handleInterrupt}
                  disabled={linkPhase !== "speaking"}
                  title="Cancel E.V.'s answer and silence it now"
                >
                  <Square size={14} /> Cut E.V. off
                </button>
              </>
            ) : (
              <>
                {isSpeaking ? (
                  <button
                    type="button"
                    className="ev-btn"
                    onClick={handleInterrupt}
                    title="Stop E.V.'s voice playback"
                  >
                    <Square size={14} /> Interrupt E.V.
                  </button>
                ) : (
                  <button
                    type="button"
                    className="ev-btn ev-btn-primary"
                    disabled={isProcessing || (!hasPendingTurn && !interim)}
                    onClick={handleManualSend}
                    title="Send current speech immediately"
                  >
                    <Send size={14} /> Send speech turn
                  </button>
                )}
              </>
            )}

            {linkMode === "realtime" && linkPhase === "renewing" && (
              <span className="ev-hint ev-mono" style={{ fontSize: 12 }}>
                Renewing the voice session — the conversation carries over…
              </span>
            )}
            {isProcessing && (
              <span className="ev-hint ev-mono" style={{ fontSize: 12 }}>
                E.V. is thinking…
              </span>
            )}
            {isSpeaking && (
              <span className="ev-hint ev-mono" style={{ fontSize: 12, color: "var(--color-ev-cyan)" }}>
                E.V. is speaking — talk over it any time to cut in.
              </span>
            )}
            {recording && recState === "waiting" && linkMode === "realtime" && !recUnsupported && (
              <p className="ev-hint" role="status" style={{ marginTop: 6, flexBasis: "100%" }}>
                {WAITING_REALTIME}
              </p>
            )}
            {recording && recState === "waiting" && linkMode === "local" && (
              <p className="ev-hint" role="status" style={{ marginTop: 6, flexBasis: "100%" }}>
                {WAITING_LOCAL}
              </p>
            )}
            {recording && recState === "capturing" && linkMode === "local" && (
              <p className="ev-hint" role="status" style={{ marginTop: 6, flexBasis: "100%" }}>
                {CAPTURING_LOCAL}
              </p>
            )}
            {recording && recState === "capturing" && (
              <p className="ev-hint" style={{ marginTop: 6, flexBasis: "100%" }}>
                {DISCARD_HINT}
              </p>
            )}
            {recUnsupported && (
              <p className="ev-hint" role="status" style={{ marginTop: 6, flexBasis: "100%" }}>
                {UNSUPPORTED_HINT}
              </p>
            )}
          </div>
        )}

        {phase === "ending" && (
          <p className="ev-hint">Closing session, saving transcript…</p>
        )}

        {phase === "denied" && (
          <div className="ev-empty">
            <span>Microphone access was denied.</span>
            <span className="ev-hint">
              Allow microphone permission in the browser address bar, then try
              again. Text conversation keeps working meanwhile.
            </span>
            <button
              type="button"
              className="ev-btn ev-btn-sm"
              onClick={() => void begin()}
            >
              <Mic /> Try again
            </button>
          </div>
        )}

        {phase === "unsupported" && (
          <div className="ev-empty">
            <span>Live transcription is not supported in this browser.</span>
            <span className="ev-hint">
              Chrome or Edge on desktop handles on-device dictation, and any
              modern browser handles realtime sessions. Your text thread is
              unaffected — continue there.
            </span>
            <Link href="/assistant" className="ev-btn ev-btn-sm">
              Return to text
            </Link>
          </div>
        )}

        {notice && phase === "live" && (
          <div className="ev-banner" role="status">
            <span>
              {linkMode === "realtime" ? <strong>Voice link.</strong> : <strong>Conversational voice mode.</strong>}{" "}
              {notice}
            </span>
          </div>
        )}
      </section>

      <section className="ev-panel" aria-label="Transcript">
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
          }}
        >
          <SectionLabel>Transcript · Progressive</SectionLabel>
          {saved && (
            <span className="ev-hint">
              <Save size={12} /> Saved to history
            </span>
          )}
        </div>
        <div
          className="ev-transcript"
          style={{ marginTop: 10 }}
          aria-live="polite"
        >
          {lines.length === 0 && !interim ? (
            <span className="ev-hint">
              {phase === "live"
                ? "Listening — speak and E.V. answers aloud; both sides appear here."
                : "No transcript yet this session."}
            </span>
          ) : (
            <>
              {lines.map((line, i) => (
                <p
                  key={i}
                  style={{ margin: 0, fontSize: 14, lineHeight: 1.6 }}
                >
                  <strong style={{ color: line.speaker === "assistant" ? "var(--color-ev-cyan)" : "#8d99a6" }}>
                    {line.speaker === "assistant" ? "E.V." : "Alfarez"}:
                  </strong>{" "}
                  {line.interrupted ? (
                    <span style={{ color: "var(--color-ev-muted)" }}>
                      {line.text}{" "}
                      <em style={{ fontSize: 12 }}>
                        (cut off — you talked over E.V.)
                      </em>
                    </span>
                  ) : (
                    line.text
                  )}
                </p>
              ))}
              {interim && (
                <p style={{ margin: 0, fontSize: 14, color: "#8d99a6" }}>
                  <em>{interim}…</em>
                </p>
              )}
            </>
          )}
        </div>
        <p className="ev-hint" style={{ marginTop: 10 }}>
          {settings.transcriptPersistence
            ? "Every voice turn is appended to the active conversation as it happens — voice and text stay one thread."
            : "Transcript persistence is disabled in Settings — nothing will be saved."}{" "}
          <Link href="/assistant" className="ev-icon-btn">
            <VolumeX size={13} /> Return to text without loss
          </Link>
        </p>
      </section>

      <SavedRecordings refreshSignal={savedTick} />
    </div>
  );
}

export default function VoicePage() {
  return (
    <Suspense fallback={<div className="ev-empty">Loading voice link…</div>}>
      <VoiceInner />
    </Suspense>
  );
}