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

import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Mic,
  MicOff,
  PhoneOff,
  Save,
  Send,
  VolumeX,
} from "lucide-react";
import { VoicePoweredOrb } from "@/components/ui/voice-powered-orb";
import LevelMeter from "@/components/voice/level-meter";
import SavedRecordings from "@/components/voice/saved-recordings";
import CloudPill from "@/components/cloud-pill";
import { SectionLabel, StatusPill } from "@/components/ui";
import {
  resolveActiveVoice,
  savedFishVoices,
  speakOptionsForVoice,
} from "@/lib/voice-options";
import {
  BackendUnavailableError,
  createVoiceSession,
  postChatStream,
  speakText,
  type ChatPayloadMessage,
  type ChatRequestExtra,
  type SpeakTextOptions,
} from "@/lib/api";
import { PersistenceError, saveRecording } from "@/lib/db";
import {
  startRealtimeSession,
  type RealtimeHandle,
  type RealtimePhase,
  type RealtimeRateLimit,
  type RealtimeCredentials,
} from "@/lib/realtime";
import {
  SessionRecorder,
  formatDurationSec,
} from "@/lib/voice-recording";
import {
  newId,
  type CoreState,
  type Recording,
  type RecordingSource,
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

interface SpeechRecognitionResult {
  isFinal: boolean;
  0: { transcript: string };
}

interface SpeechResultEventLike {
  resultIndex: number;
  results: {
    length: number;
    item(index: number): SpeechRecognitionResult | null;
    [index: number]: SpeechRecognitionResult;
  };
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
  /** Local-mode TTS blob for this assistant reply, kept so the single
   * reply can be replayed or saved on its own. Never persisted wholesale —
   * the save button below writes one recording per tap. */
  audio?: Blob;
}

/** Auto-title a saved segment from its first user line. */
function recordingTitle(lines: TranscriptLine[], fromIndex: number): string {
  const firstUser = lines.slice(fromIndex).find((line) => line.speaker === "user");
  const clean = (firstUser?.text ?? "").replace(/\s+/g, " ").trim();
  if (!clean) return "Voice recording";
  return clean.length > 44 ? `${clean.slice(0, 44)}…` : clean;
}

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
  const router = useRouter();
  const searchParams = useSearchParams();
  const stageRef = useRef<HTMLElement | null>(null);
  const orbWrapRef = useRef<HTMLDivElement | null>(null);
  const controlsRef = useRef<HTMLDivElement | null>(null);
  const {
    active,
    activeId,
    newConversation,
    appendMessage,
    setCoreState,
    settings,
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
  const [recUnsupported, setRecUnsupported] = useState(false);
  const [recElapsed, setRecElapsed] = useState(0);
  const [savingRecording, setSavingRecording] = useState(false);
  const [savedTick, setSavedTick] = useState(0);
  const [saved, setSaved] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [hasPendingTurn, setHasPendingTurn] = useState(false);
  const [isTurnInFlight, setIsTurnInFlight] = useState(false);
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
  const silenceTimerRef = useRef<number | undefined>(undefined);
  const pendingUserTurnRef = useRef<string>("");
  // Fires the turn only after a long stretch with zero new results: the
  // recognizer's own signal that you really stopped talking.
  const endOfSpeechTimerRef = useRef<number | undefined>(undefined);
  // Keep references to state values needed inside callbacks
  const activeIdRef = useRef(activeId);
  const settingsRef = useRef(settings);
  const memoriesRef = useRef(memories);
  const notesRef = useRef(notes);
  const convIdRef = useRef<string | null>(null);
  const isTurnInFlightRef = useRef(false);
  const aliveRef = useRef(true);
  const mutedRef = useRef(false);
  const phaseRef = useRef<VoicePhase>("ready");
  const reduced = !motionAllowed(settings.reducedMotionOverride);
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
  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  // Play one TTS reply blob through an <audio> element. Resolves true when
  // the audio actually played to completion, false when playback failed
  // (autoplay block, decode error). Barge-in safe: stopPlayback pauses the
  // tracked element alongside speechSynthesis.
  const replyAudioRef = useRef<HTMLAudioElement | null>(null);
  const playBlob = useCallback((blob: Blob): Promise<boolean> => {
    const { promise, resolve } = Promise.withResolvers<boolean>();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    replyAudioRef.current = audio;
    const cleanup = () => {
      URL.revokeObjectURL(url);
      if (replyAudioRef.current === audio) replyAudioRef.current = null;
    };
    audio.onended = () => {
      cleanup();
      resolve(true);
    };
    audio.onerror = () => {
      cleanup();
      resolve(false);
    };
    audio.play().catch(() => {
      cleanup();
      resolve(false);
    });
    return promise;
  }, []);

  const stopPlayback = useCallback(() => {
    if (replyAudioRef.current) {
      replyAudioRef.current.pause();
      replyAudioRef.current.src = "";
      replyAudioRef.current = null;
    }
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    if (aliveRef.current) {
      setIsSpeaking(false);
    }
  }, []);

  const teardown = useCallback(() => {
    clearTimeout(silenceTimerRef.current);
    silenceTimerRef.current = undefined;
    clearTimeout(endOfSpeechTimerRef.current);
    endOfSpeechTimerRef.current = undefined;
    pendingUserTurnRef.current = "";
    if (recorderRef.current) {
      recorderRef.current.dispose();
      recorderRef.current = null;
    }
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


  const handleLocalTurn = useCallback(async (text: string) => {
    if (isTurnInFlightRef.current) return;
    isTurnInFlightRef.current = true;
    setIsTurnInFlight(true);
    setHasPendingTurn(true);

    // Add user to transcript
    setLines((prev) => [...prev, { speaker: "user", text }]);
    linesRef.current = [...linesRef.current, { speaker: "user", text }];

    // Create/get conversation
    let convId = activeIdRef.current;
    if (!convId) {
      convId = await newConversation();
      activeIdRef.current = convId;
      convIdRef.current = convId;
    }

    // Stream chat
    const history: ChatPayloadMessage[] = [
      ...memoriesRef.current
        .filter((m) => m.enabled)
        .slice(0, 12)
        .map((m) => ({ role: "system" as const, content: m.text })),
      ...notesRef.current
        .slice(0, 100)
        .map((n) => ({ role: "system" as const, content: `${n.title}: ${n.body}` })),
      { role: "user", content: text },
    ];

    try {
      const extra: ChatRequestExtra = {
        conversationId: convId,
        mode: settings.chatMode,
      };

      const result = await postChatStream(history, {
        extra,
        onToken: (token: string) => {
          interimAssistant.current += token;
        },
      });

      const reply = result.text?.trim() ?? "";
      if (reply) {
        // Add to transcript
        setLines((prev) => [...prev, { speaker: "assistant", text: reply }]);
        linesRef.current = [...linesRef.current, { speaker: "assistant", text: reply }];

        // Speak aloud: fetch the TTS blob, play it so E.V. is heard, and
        // tee it into the session recorder (E.V.'s voice only, never mic).
        const activeVoice = resolveActiveVoice(settingsRef.current);
        const speakOpts = speakOptionsForVoice(activeVoice, settingsRef.current);
        const { blob } = await speakText(reply, { ...speakOpts, allowFallback: true });
        recorderRef.current?.appendReply(blob);
        // Keep the blob on the line so this exact reply can be replayed or
        // saved individually from its own button.
        setLines((prev) => {
          const next = [...prev];
          const lastIdx = next.findLastIndex((l) => l.speaker === "assistant");
          if (lastIdx >= 0) next[lastIdx] = { ...next[lastIdx]!, audio: blob };
          return next;
        });
        const lrIdx = linesRef.current.findLastIndex((l) => l.speaker === "assistant");
        if (lrIdx >= 0) linesRef.current[lrIdx] = { ...linesRef.current[lrIdx]!, audio: blob };
        setIsSpeaking(true);
        let heard = true;
        try {
          heard = await playBlob(blob);
        } catch {
          heard = false;
        } finally {
          if (aliveRef.current) setIsSpeaking(false);
        }
        if (!heard) {
          setNotice("E.V. answered (see transcript) but the reply audio could not play — check the tab is unmuted and autoplay is allowed, then speak to continue.");
        }
        // The reply's own audio ends the recognizer (continuous mode still
        // auto-ends on sustained speaker output): restart it so the next
        // user turn is heard. Muted/teardown states stay stopped.
        if (
          aliveRef.current &&
          phaseRef.current === "live" &&
          linkModeRef.current === "local" &&
          !mutedRef.current &&
          recogRef.current
        ) {
          try {
            recogRef.current.start();
          } catch (e: unknown) {
            const err = e as DOMException;
            // Already running (e.g. onend beat us): not an error.
            if (err.name !== "InvalidStateError") throw e;
          }
        }

        // Persist to conversation
        await appendMessage(convId, {
          id: newId("msg"),
          role: "assistant",
          content: reply,
          createdAt: Date.now(),
        });
      }
    } catch (err) {
      if (err instanceof BackendUnavailableError) {
        if (err.code === "setup_required") {
          setNotice("No OpenRouter key — add one in Settings → Advanced so E.V. can answer.");
        } else if (err.code === "model_overloaded") {
          setNotice(`${err.message} ${err.hint}`);
        } else {
          setNotice(`${err.message} ${err.hint}`);
        }
      } else {
        setNotice("Local turn failed. Check connection.");
      }
    } finally {
      isTurnInFlightRef.current = false;
      setIsTurnInFlight(false);
      setHasPendingTurn(false);
      interimAssistant.current = "";
    }
  }, [activeIdRef, newConversation, memoriesRef, notesRef, settings, appendMessage, playBlob]);

  // Send-now: fire the accumulated draft immediately instead of waiting out
  // the silence window. Clears the timer so it can't double-fire.
  const flushPendingTurn = useCallback(() => {
    const text = pendingUserTurnRef.current.trim();
    pendingUserTurnRef.current = "";
    clearTimeout(silenceTimerRef.current);
    silenceTimerRef.current = undefined;
    clearTimeout(endOfSpeechTimerRef.current);
    endOfSpeechTimerRef.current = undefined;
    if (!text || mutedRef.current || isTurnInFlightRef.current) return;
    setInterim("");
    setHasPendingTurn(false);
    handleLocalTurn(text);
  }, [handleLocalTurn]);

  const startLocal = useCallback(async () => {
    setPhase("live");
    setLinkMode("local");
    setCoreState("listening");
    linkModeRef.current = "local";
    recordActivity("voice", "Local voice mode started");

    const Recognizer = getRecognizer();
    if (!Recognizer) {
      setNotice("Speech recognition not supported in this browser.");
      setPhase("unsupported");
      return;
    }

    const recognition = new Recognizer();
    recogRef.current = recognition;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    // End-of-speech turn detection. The recognizer emits finals per pause,
    // not per thought — so a bare silence timer either fires mid-sentence
    // or strands the turn. Instead: short pauses (1.2s) only *settle* the
    // draft into the interim line; the turn fires when the recognizer
    // itself signals end-of-speech (result streak ends + sound ends), or
    // when silence stretches to 6s, or via Send-now. Interim always shows
    // the full accumulating draft so you see the whole sentence building.
    recognition.onresult = (event: SpeechResultEventLike) => {
      if (mutedRef.current) return;
      let freshFinal = "";
      let liveTail = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const res = event.results.item(i);
        if (!res) continue;
        if (res.isFinal) {
          freshFinal += res[0].transcript;
        } else {
          liveTail = res[0].transcript;
        }
      }
      if (freshFinal.trim()) {
        pendingUserTurnRef.current +=
          (pendingUserTurnRef.current ? " " : "") + freshFinal.trim();
        // Short pause: settle the draft visibly, keep listening.
        clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = window.setTimeout(() => {
          silenceTimerRef.current = undefined;
          if (mutedRef.current || isTurnInFlightRef.current) return;
          // Still only a pause — surface the draft, don't send.
          const settled = pendingUserTurnRef.current.trim();
          if (settled) {
            setInterim(settled);
            setHasPendingTurn(true);
          }
        }, 1200);
        // Long silence with no new results: you really stopped talking.
        clearTimeout(endOfSpeechTimerRef.current);
        endOfSpeechTimerRef.current = window.setTimeout(() => {
          endOfSpeechTimerRef.current = undefined;
          flushPendingTurn();
        }, 6000);
      }
      const draft = (
        pendingUserTurnRef.current +
        (liveTail ? ` ${liveTail}` : "")
      ).trim();
      setInterim(draft);
      setHasPendingTurn(draft.length > 0);
    };

    recognition.onerror = (e: { error: string }) => {
      if (e.error !== "aborted" && e.error !== "no-speech") {
        setNotice(`Speech error: ${e.error}`);
      }
    };

    recognition.onend = () => {
      // Recognizer ended on its own (end of utterance or speaker silence):
      // if a draft is waiting, you really stopped talking — send it.
      // Otherwise auto-restart unless we're ending.
      if (pendingUserTurnRef.current.trim()) {
        flushPendingTurn();
        return;
      }
      if (aliveRef.current && phaseRef.current === "live") {
        // Auto-restart unless we're ending
        recognition.start();
      }
    };

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      setMicStream(stream);
      recognition.start();
    } catch {
      setNotice("Microphone access denied.");
      setPhase("denied");
    }
  }, [phase, recordActivity, setCoreState, handleLocalTurn]);

  // Realtime session management
  const startRealtime = useCallback(async () => {
    if (phase !== "ready") return;
    setPhase("requesting");
    setLinkPhase("connecting");
    setCoreState("connecting");

    try {
      // Get microphone stream first
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      setMicStream(stream);

      // Create mint function that returns credentials
      const mint = async (): Promise<RealtimeCredentials> => {
        const session = await createVoiceSession();
        if (!session?.clientSecret) {
          throw new BackendUnavailableError(
            "Failed to create voice session — no client secret returned.",
            "Check /api/voice/session logs. The backend may be missing OPENAI_API_KEY.",
          );
        }
        return {
          clientSecret: session.clientSecret,
          realtimeUrl: session.realtimeUrl,
          dataChannel: session.webrtc?.dataChannel,
          expiresAt: session.expiresAt,
        };
      };

      const handle = await startRealtimeSession({
        mint,
        stream,
        onState: (p: RealtimePhase, detail?: string) => {
          setLinkPhase(p);
          setCoreState(REALTIME_TO_CORE[p] ?? "idle");
        },
        onRemoteStream: (remote: MediaStream) => {
          setRemoteStream(remote);
          if (!recording) startSessionRecording();
          setRecState("capturing");
        },
        onTranscript: (text: string, final: boolean, speaker?: "user" | "assistant") => {
          if (speaker === "user" && final) {
            setLines((prev) => [...prev, { speaker: "user", text }]);
            linesRef.current = [...linesRef.current, { speaker: "user", text }];
            segmentStartRef.current = linesRef.current.length;
          } else if (speaker === "assistant") {
            interimAssistant.current = text;
            if (final) {
              // Replace the last assistant interim line or add new
              setLines((prev) => {
                const next = [...prev];
                const lastIdx = next.findLastIndex((l) => l.speaker === "assistant");
                if (lastIdx >= 0) {
                  const lastLine = next[lastIdx]!;
                  if (lastLine.interrupted) {
                    next[lastIdx] = { speaker: "assistant", text, interrupted: false };
                  } else {
                    next[lastIdx] = { speaker: "assistant", text };
                  }
                } else {
                  next.push({ speaker: "assistant", text });
                }
                return next;
              });
              const lastAssistantIdx = linesRef.current.findLastIndex((x) => x.speaker === "assistant");
              linesRef.current = linesRef.current.map((l, idx) => {
                if (l.speaker === "assistant" && l.interrupted && idx === lastAssistantIdx) {
                  return { ...l, text, interrupted: false };
                }
                return l;
              });
            }
          }
        },
        onInterruption: (partial: string) => {
          setLines((prev) => {
            const next = [...prev];
            if (next.length > 0) {
              const lastIdx = next.length - 1;
              const lastLine = next[lastIdx]!;
              if (lastLine.speaker === "assistant") {
                next[lastIdx] = { speaker: "assistant", text: lastLine.text, interrupted: true };
              }
            }
            return next;
          });
          linesRef.current = linesRef.current.map((l) =>
            l.speaker === "assistant" && !l.interrupted ? { ...l, interrupted: true } : l
          );
          if (partial) {
            interimAssistant.current = partial;
          }
        },
        onRateLimits: (limits: RealtimeRateLimit[]) => setRateLimits(limits),
      });

      realtimeRef.current = handle;
      setPhase("live");
      setLinkPhase("live");
      linkModeRef.current = "realtime";
      recordActivity("voice", "Realtime session started");
    } catch (err) {
      if (err instanceof BackendUnavailableError) {
        setNotice(err.message);
      } else {
        setNotice("Failed to start voice link. Falling back to local mode.");
      }
      await startLocal();
      setCoreState("error");
    }
  }, [phase, recording, recordActivity, setCoreState, startSessionRecording]);

  // Barge-in: stop current response
  const handleBargeIn = useCallback(() => {
    if (linkMode === "realtime" && realtimeRef.current) {
      realtimeRef.current.interrupt();
      setLinkPhase("interrupted");
      setIsProcessing(false);
    } else {
      stopPlayback();
    }
    setHasPendingTurn(false);
    isTurnInFlightRef.current = false;
    interimAssistant.current = "";
  }, [linkMode, stopPlayback]);

  // Mute local microphone
  const toggleMute = useCallback(() => {
    const next = !muted;
    setMuted(next);
    if (linkMode === "realtime" && realtimeRef.current) {
      realtimeRef.current.setMicEnabled(!next);
    } else if (streamRef.current) {
      streamRef.current.getAudioTracks().forEach((t) => (t.enabled = !next));
    }
    // Local mode: gate the Web Speech recognizer
    if (linkMode === "local") {
      if (next) {
        // Muting: stop recognizer so in-flight utterance doesn't complete
        recogRef.current?.stop();
      } else if (phaseRef.current === "live") {
        // Unmuting: restart recognizer if still live
        try {
          recogRef.current?.start();
        } catch (e: unknown) {
          const err = e as DOMException;
          // Ignore InvalidStateError (already started)
          if (err.name !== "InvalidStateError") throw e;
        }
      }
    }
  }, [muted, linkMode]);

  // End session
  const endSession = useCallback(async () => {
    setPhase("ending");
    if (linkMode === "realtime" && realtimeRef.current) {
      await realtimeRef.current.stop();
    }
    teardown();
    setPhase("ready");
    setCoreState("idle");
  }, [linkMode, teardown, setCoreState]);

  // Save recording
  const handleSaveRecording = useCallback(async () => {
    if (!recorderRef.current) return;
    setSavingRecording(true);
    try {
      const segment = await recorderRef.current.snapshot();
      if (!segment) {
        setNotice("Nothing to save — E.V. hasn't spoken yet.");
        return;
      }
      const title = recordingTitle(linesRef.current, segmentStartRef.current);
      const recordingToSave: Recording = {
        id: newId("rec"),
        title,
        source: linkMode === "realtime" ? "realtime" : "local-tts",
        createdAt: Date.now(),
        durationSec: segment.durationSec,
        mimeType: segment.mimeType,
        sizeBytes: segment.blob.size,
        blob: segment.blob,
      };
      await saveRecording(recordingToSave);
      setSaved(true);
      setSavedTick((t) => t + 1);
      setTimeout(() => setSaved(false), 2000);
      recordActivity("voice", `Saved recording: ${title}`);
    } catch (err) {
      if (err instanceof PersistenceError) {
        setNotice(err.message);
      } else {
        setNotice("Failed to save recording.");
      }
    } finally {
      setSavingRecording(false);
    }
  }, [linkMode, recordActivity]);

  // Save one assistant reply's own audio (its per-line button). Falls back
  // to the session recorder only when the line kept no blob.
  const [savingLine, setSavingLine] = useState<number | null>(null);
  const handleSaveLine = useCallback(async (index: number) => {
    const line = linesRef.current[index];
    if (!line || line.speaker !== "assistant") return;
    setSavingLine(index);
    try {
      const blob = line.audio ?? (await recorderRef.current?.snapshot())?.blob;
      if (!blob || blob.size === 0) {
        setNotice("Nothing saved for this reply yet — wait for E.V. to finish speaking.");
        return;
      }
      const title = line.text.length > 44 ? `${line.text.slice(0, 44)}…` : line.text || "Voice reply";
      await saveRecording({
        id: newId("rec"),
        title,
        source: "local-tts",
        createdAt: Date.now(),
        durationSec: 0,
        mimeType: blob.type,
        sizeBytes: blob.size,
        blob,
      });
      setSaved(true);
      setSavedTick((t) => t + 1);
      setTimeout(() => setSaved(false), 2000);
      recordActivity("voice", `Saved reply: ${title}`);
    } catch (err) {
      if (err instanceof PersistenceError) {
        setNotice(err.message);
      } else {
        setNotice("Failed to save this reply.");
      }
    } finally {
      setSavingLine(null);
    }
  }, [recordActivity]);
  const handleStart = useCallback(() => {
    if (phase === "ready") {
      const hasOpenRouterKey = (settingsRef.current.openRouterApiKey ?? "").trim().length > 0;
      if (hasOpenRouterKey) {
        startLocal();
      } else if (backendConfigured) {
        startRealtime();
      } else {
        startLocal();
      }
    }
  }, [phase, backendConfigured, startRealtime, startLocal]);

  // Auto-start voice session when ?auto=1
  const autoStartedRef = useRef(false);
  useEffect(() => {
    if (searchParams.get("auto") === "1" && phase === "ready" && !autoStartedRef.current) {
      autoStartedRef.current = true;
      handleStart();
      router.replace("/voice", { scroll: false });
    }
  }, [searchParams, phase, handleStart, router]);

  // Stage choreography: orb entrance on mount, swell on phase changes.
  // Reduced-motion (system or settings override) skips everything.
  useGSAP(
    () => {
      if (reduced) return;
      if (orbWrapRef.current) {
        gsap.fromTo(
          orbWrapRef.current,
          { scale: 0.82, opacity: 0 },
          { scale: 1, opacity: 1, duration: 1.1, ease: "expo.out" },
        );
      }
    },
    { scope: stageRef, dependencies: [] },
  );

  useGSAP(
    () => {
      if (reduced || !orbWrapRef.current) return;
      const speaking = linkPhase === "speaking" || linkPhase === "processing";
      gsap.to(orbWrapRef.current, {
        scale: speaking ? 1.06 : 1,
        duration: 0.7,
        ease: "sine.inOut",
      });
      if (controlsRef.current && phase === "live") {
        gsap.fromTo(
          controlsRef.current.children,
          { y: 14, opacity: 0 },
          { y: 0, opacity: 1, duration: 0.45, stagger: 0.07, ease: "back.out(1.6)" },
        );
      }
    },
    { scope: stageRef, dependencies: [phase, linkPhase] },
  );

  // Render phase badge - use useMemo to avoid creating component during render
  const PhaseBadge = useMemo(() => {
    if (phase !== "live") return null;
    const label = LINK_LABEL[linkPhase ?? "live"];
    const tone: "ok" | "warn" | "bad" | "mute" = linkPhase === "speaking" || linkPhase === "processing"
      ? "ok"
      : linkPhase === "interrupted"
      ? "bad"
      : "ok";
    const dotTone = tone === "ok" ? "ok" : tone === "bad" ? "bad" : "ok";
    return (
      <StatusPill tone={tone}>
        <span className={`ev-dot ev-dot-${dotTone}`} aria-hidden="true" />
        {label}
      </StatusPill>
    );
  }, [phase, linkPhase]);

  return (
    <div className="ev-voice-page">
      {/* Full-bleed orb stage */}
      <section ref={stageRef} className="ev-voice-stage" aria-label="Voice session">
        <div className="ev-voice-stage-header">
          {PhaseBadge}
          <CloudPill />
        </div>

        <div ref={orbWrapRef} className="ev-voice-orb-wrapper">
          <VoicePoweredOrb
            hue={187}
            enableVoiceControl={phase === "live"}
            className="ev-voice-orb"
          />
        </div>

        {phase === "live" && (
          <div ref={controlsRef} className="ev-voice-controls">
            <button
              type="button"
              className={`ev-btn ev-btn-ghost ev-mic-btn ${muted ? "ev-muted" : ""}`}
              onClick={toggleMute}
              aria-pressed={muted}
              aria-label={muted ? "Unmute" : "Mute"}
            >
              {muted ? <MicOff size={20} /> : <Mic size={20} />}
            </button>
            {linkMode === "local" && hasPendingTurn && !isTurnInFlight && (
              <button
                type="button"
                className="ev-btn ev-btn-primary ev-send-now-btn"
                onClick={flushPendingTurn}
                aria-label="Send your dictated sentence now"
                title="Send now — don't wait for the pause window"
              >
                <Send size={16} /> Send now
              </button>
            )}
            <button
              type="button"
              className="ev-btn ev-btn-danger ev-end-btn"
              onClick={endSession}
              aria-label="End voice session"
            >
              <PhoneOff size={18} /> End
            </button>
            {recording && (
              <button
                type="button"
                className="ev-btn ev-btn-primary ev-save-btn"
                onClick={handleSaveRecording}
                disabled={savingRecording || recState === "waiting"}
                aria-label="Save recording"
              >
                {savingRecording ? (
                  <>
                    <span className="ev-spinner" aria-hidden="true" />
                    Saving…
                  </>
                ) : recState === "waiting" ? (
                  <>
                    <Save size={18} /> Save recording
                  </>
                ) : (
                  <>
                    <Save size={18} /> Save · {formatDurationSec(recElapsed)}
                  </>
                )}
              </button>
            )}
          </div>
        )}

        {/* Standby state */}
        {phase !== "live" && (
          <div className="ev-voice-standby">
            <StatusPill
              tone={phase === "requesting" || phase === "ending" ? "warn" : "mute"}
            >
              {phase === "requesting" ? "Connecting…" : phase === "ending" ? "Ending…" : "Standby"}
            </StatusPill>
            <button
              type="button"
              className="ev-btn ev-btn-primary ev-start-btn"
              onClick={handleStart}
              disabled={phase === "requesting" || phase === "ending"}
            >
              {phase === "requesting" ? "Connecting…" : "Start Voice Session"}
            </button>
            {notice && (
              <p className="ev-hint ev-notice" role="alert">
                {notice}
              </p>
            )}
            {phase === "unsupported" && (
              <p className="ev-hint" style={{ marginTop: 8 }}>
                Falling back to local mode: speak, E.V. answers via text-to-speech.
              </p>
            )}
          </div>
        )}
      </section>

      {/* Transcript & controls below the fold */}
      <div className="ev-voice-below">
        {/* Transcript panel */}
        <section className="ev-panel ev-transcript-panel" aria-label="Transcript">
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
            <SectionLabel>Transcript · Progressive</SectionLabel>
            {saved && (
              <span className="ev-hint">
                <Save size={12} /> Saved to history
              </span>
            )}
          </div>
          <div className="ev-transcript" aria-live="polite">
            {lines.length === 0 && !interim ? (
              <span className="ev-hint">
                {phase === "live"
                  ? "Listening — speak and E.V. answers aloud; both sides appear here."
                  : "No transcript yet this session. Start a voice session to begin."}
              </span>
            ) : (
              <>
                {lines.map((line, i) => (
                  <div key={i} className="ev-transcript-line">
                    <p style={{ margin: 0 }}>
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
                    {line.speaker === "assistant" && !line.interrupted && (
                      <button
                        type="button"
                        className="ev-icon-btn ev-reply-save"
                        onClick={() => void handleSaveLine(i)}
                        disabled={savingLine === i}
                        aria-label={`Save E.V.'s reply ${i + 1} as a recording`}
                        title="Save this reply's voice"
                      >
                        <Save size={13} /> {savingLine === i ? "Saving…" : "Save voice"}
                      </button>
                    )}
                  </div>
                ))}
                {interim && (
                  <p className="ev-transcript-interim">
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

        {/* Level meters when live */}
        {phase === "live" && (
          <section className="ev-panel ev-level-panel" aria-label="Audio levels">
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
              <LevelMeter
                stream={micStream}
                label="Microphone"
                tone="in"
              />
              <LevelMeter
                stream={remoteStream}
                label="E.V. (remote)"
                tone="out"
              />
              {recording && (
                <span className="ev-rec-indicator" aria-live="polite">
                  <span className="ev-dot ev-dot-bad" aria-hidden="true" style={{ animation: "ev-pulse 1s ease-in-out infinite" }} />
                  REC · {formatDurationSec(recElapsed)}
                </span>
              )}
            </div>
          </section>
        )}

        {/* Saved recordings panel */}
        <SavedRecordings refreshSignal={savedTick} />
      </div>
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