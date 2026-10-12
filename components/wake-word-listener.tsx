/* PROJECT E.V. — opt-in ambient wake word ("Hey E.V.") (voice-owned).
   Deliberately never starts recognition on its own: recognition runs only
   while `wakeWordEnabled` is true in the owner's Settings, i.e. after an
   explicit action. The armed indicator and one-click disarm live here so the
   mic state is never invisible. Unsupported browsers and denied microphone
   permission surface a labelled state instead of silently doing nothing.

   On a wake it navigates to /voice?auto=1&q=… where the voice page owns the
   microphone for the live session; this listener is torn down before the
   page takes over so two mic owners never overlap. */

"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Mic, MicOff } from "lucide-react";
import { useEv } from "@/lib/store";

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<{
    isFinal?: boolean;
    0: { transcript: string };
  }>;
}

type WakeState = "off" | "armed" | "denied" | "unsupported";

function getRecognizer(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as Record<string, unknown>;
  const ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  if (typeof ctor !== "function") return null;
  return ctor as new () => SpeechRecognitionLike;
}

/** Plays 520Hz -> 660Hz -> 780Hz quick futuristic chime */
function playWakeChime() {
  try {
    const win = window as Window & typeof globalThis & {
      webkitAudioContext?: typeof AudioContext;
    };
    const AudioCtx = win.AudioContext ?? win.webkitAudioContext;
    if (!AudioCtx) return;

    const ctx = new AudioCtx();
    const now = ctx.currentTime;
    const freqs = [520, 660, 780];
    const noteDuration = 0.08;

    freqs.forEach((freq, idx) => {
      const startTime = now + idx * noteDuration;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, startTime);
      gain.gain.setValueAtTime(0.0001, startTime);
      gain.gain.exponentialRampToValueAtTime(0.25, startTime + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, startTime + noteDuration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(startTime);
      osc.stop(startTime + noteDuration);
    });

    setTimeout(() => {
      void ctx.close().catch(() => undefined);
    }, (freqs.length * noteDuration + 0.2) * 1000);
  } catch (err) {
    console.warn("Could not play wake chime:", err);
  }
}

/**
 * Wake Word regex matching: "E.V.", "Hey E.V.", "Hey EV", "OK E.V.", "Hi E.V.".
 * Matches: (?:hey|ok|hi)?\s*(?:ev|e\.v\.|eve)\b
 */
const WAKE_WORD_REGEX = /(?:hey|ok|hi)?\s*(?:ev|e\.v\.|eve)\b/i;

export default function WakeWordListener() {
  const { wakeWordEnabled, setWakeWordEnabled, recordActivity } = useEv();
  const pathname = usePathname();
  const router = useRouter();
  /** Mic permission refused or the recognition service stopped. */
  const [denied, setDenied] = useState(false);

  const isNavigatingRef = useRef(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const activeRef = useRef(false);
  const wakeWordEnabledRef = useRef(wakeWordEnabled);
  const pathnameRef = useRef(pathname);

  useEffect(() => {
    wakeWordEnabledRef.current = wakeWordEnabled;
    pathnameRef.current = pathname;
  }, [wakeWordEnabled, pathname]);

  // All listener states are derived — no setState in the effect body, so no
  // cascading renders. `denied` flips only from recognition callbacks.
  const armed = wakeWordEnabled && pathname !== "/voice";
  const supported = armed && getRecognizer() !== null;
  const state: WakeState = !armed
    ? "off"
    : !supported
      ? "unsupported"
      : denied
        ? "denied"
        : "armed";

  useEffect(() => {
    if (denied) return; // surfaced below; re-armed via the retry button
    if (!wakeWordEnabled || pathname === "/voice") {
      // The /voice page owns the microphone during a live session.
      if (recognitionRef.current) {
        try {
          recognitionRef.current.onend = null;
          recognitionRef.current.stop();
        } catch {
          /* already stopped */
        }
        recognitionRef.current = null;
      }
      activeRef.current = false;
      return;
    }

    const Recognizer = getRecognizer();
    if (!Recognizer) return;

    let recognition: SpeechRecognitionLike;
    try {
      recognition = new Recognizer();
    } catch (err) {
      console.warn("Failed to construct SpeechRecognition for wake word:", err);
      return;
    }

    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognitionRef.current = recognition;
    activeRef.current = true;
    isNavigatingRef.current = false;

    recognition.onresult = (event: SpeechRecognitionEventLike) => {
      if (isNavigatingRef.current) return;
      if (pathnameRef.current === "/voice") return;

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const item = event.results[i];
        if (!item || !item[0]) continue;
        const transcript = item[0].transcript.trim();

        const match = WAKE_WORD_REGEX.exec(transcript);
        if (!match) continue;
        isNavigatingRef.current = true;
        const wakeEnd = match.index + match[0].length;
        const trailing = transcript
          .slice(wakeEnd)
          .replace(/^[,.!?\s]+/, "")
          .trim();

        playWakeChime();

        void recordActivity(
          "voice",
          "Wake word activated ('Hey E.V.')",
          trailing ? `Command: "${trailing}"` : undefined,
        );

        try {
          recognition.onend = null;
          recognition.stop();
        } catch {
          /* already stopped */
        }
        recognitionRef.current = null;
        activeRef.current = false;

        router.push(
          `/voice?auto=1${trailing ? `&q=${encodeURIComponent(trailing)}` : ""}`,
        );
        break;
      }
    };

    recognition.onerror = (event: { error: string }) => {
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        setDenied(true);
        activeRef.current = false;
        return;
      }
      if (event.error !== "no-speech" && event.error !== "aborted") {
        console.warn("Wake word recognition error:", event.error);
      }
    };

    recognition.onend = () => {
      if (
        activeRef.current &&
        wakeWordEnabledRef.current &&
        !isNavigatingRef.current &&
        pathnameRef.current !== "/voice"
      ) {
        try {
          recognition.start();
        } catch {
          /* already started, or permission revoked mid-session */
        }
      }
    };

    try {
      recognition.start();
    } catch (err) {
      console.warn("Wake word recognition start failed:", err);
      activeRef.current = false;
      // Surface the denial without cascading a render from inside the effect.
      queueMicrotask(() => setDenied(true));
    }

    return () => {
      activeRef.current = false;
      try {
        recognition.onend = null;
        recognition.stop();
      } catch {
        /* already stopped */
      }
      if (recognitionRef.current === recognition) {
        recognitionRef.current = null;
      }
    };
  }, [denied, wakeWordEnabled, pathname, router, recordActivity]);

  if (pathname === "/voice" || state === "off") return null;

  if (state === "unsupported") {
    return (
      <div className="ev-banner" role="status">
        <span>
          <strong>Wake word unavailable in this browser.</strong> On-device
          SpeechRecognition is required to hear &quot;Hey E.V.&quot; — use
          Chrome or Edge on desktop, then re-arm it. Voice sessions on
          <code> /voice</code> are unaffected.
        </span>
      </div>
    );
  }

  if (state === "denied") {
    return (
      <div className="ev-banner" role="status">
        <span>
          <strong>Wake word is not hearing anything.</strong> Microphone
          permission was refused or the recognition service stopped. Allow the
          mic in the browser site settings, then re-arm it.
        </span>
        <button
          type="button"
          className="ev-btn ev-btn-sm"
          onClick={() => setDenied(false)}
        >
          <Mic size={12} /> Re-arm
        </button>
      </div>
    );
  }

  return (
    <div className="ev-banner" role="status">
      <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Mic style={{ width: 13, height: 13, color: "#35e0ff" }} />
        <span>
          <strong>Wake word armed.</strong> This page is listening for
          &quot;Hey E.V.&quot; in the background — say it to open a voice
          session.
        </span>
      </span>
      <button
        type="button"
        className="ev-btn ev-btn-sm"
        onClick={() => void setWakeWordEnabled(false)}
      >
        <MicOff size={12} /> Disarm
      </button>
    </div>
  );
}