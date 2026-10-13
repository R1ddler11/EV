"use client";

import { ArrowUp, Check, Copy, CornerDownLeft, RefreshCw, Square } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import MarkdownView from "./markdown";
import {
  BackendUnavailableError,
  postChatStream,
  type ChatPayloadMessage,
} from "@/lib/api";
import { newId, type ChatMessage, type ChatMode, type Conversation } from "@/lib/types";
import { useEv } from "@/lib/store";
import { handleUiAction } from "@/lib/ui-actions";
import { ConfirmDialog } from "./ui";
import { VoiceInput } from "./ui/voice-input";

/** Openers a person would actually type to a friend. */
export const DAILY_OPENERS = [
  "morning — how's your head today?",
  "long week. tell me something good",
  "what are you doing tonight?",
  "I can't decide on dinner, help me out",
];

/** Same console, builder register: commands, trade-offs, code. */
export const BUILDER_OPENERS = [
  "What's actually blocking this build?",
  "Walk me through the fix for that docker error.",
  "Trade-offs for going from Arch to Nix on this box?",
  "Write me a status update for today's work.",
];

export const SUGGESTED_PROMPTS: Record<ChatMode, readonly string[]> = {
  daily: DAILY_OPENERS,
  builder: BUILDER_OPENERS,
};

export interface ChatFailure {
  message: string;
  hint: string;
}

interface SendOptions {
  /** Existing conversation to target; skips creation. */
  targetId?: string;
  /** Skip appending the user turn (retry path — it already exists). */
  userAppended?: boolean;
}

/** Never spoken: an empty reply is a notice, not conversation. */
const EMPTY_REPLY_NOTICE = "(The backend answered with empty text.)";

/* ---------- local follow-up chips (no extra model call) ---------- */

const STOPWORDS = new Set([
  "about", "actually", "after", "again", "been", "before", "could", "does", "doing",
  "don't", "even", "gonna", "good", "have", "here", "into", "just", "keep", "lets",
  "like", "make", "many", "more", "much", "need", "only", "other", "over", "please",
  "really", "right", "should", "some", "still", "such", "sure", "take", "tell",
  "than", "that", "them", "then", "there", "they", "thing", "think", "this", "those",
  "thought", "through", "very", "want", "well", "were", "what", "when", "where",
  "which", "while", "with", "would", "yeah", "your", "you're",
]);

/** Longest content word in `text` — a decent stand-in for "what it's about". */
function topicWord(text: string): string | null {
  let best: string | null = null;
  for (const raw of text.toLowerCase().replace(/[^a-z0-9\s'-]/g, " ").split(/\s+/)) {
    const word = raw.replace(/^[-']+/, "");
    if (word.length < 4 || word.length > 14 || STOPWORDS.has(word)) continue;
    if (!best || word.length > best.length) best = word;
  }
  return best;
}

/** "somewhere new" -> "Somewhere new." — a bare answer reads as typed; an
 * interrogative clause keeps its "?", since tapping sends it as a message. */
const INTERROGATIVE_START =
  /^(did|do|does|is|are|was|were|should|would|can|could|will|have|has|am|what|how|why|when|where|who|which)\b/i;

function asSentence(text: string): string {
  const trimmed = text.replace(/[.?!,;:]+$/, "").trim();
  if (!trimmed) return "";
  const capped = `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}`;
  return INTERROGATIVE_START.test(trimmed) ? `${capped}?` : `${capped}.`;
}

/** The last question in a reply — the one he is actually left holding. */
function lastQuestion(text: string): string {
  const end = text.lastIndexOf("?");
  if (end < 0) return "";
  let start = end;
  while (start > 0) {
    const prev = text[start - 1];
    if (!prev || ".!?".includes(prev)) break;
    start--;
  }
  return text.slice(start, end + 1).trim();
}

/** Chips keyed off what the exchange was about, in his register. */
const TOPIC_FOLLOWUPS: { match: RegExp; chips: string[] }[] = [
  {
    match: /\b(sleep|slept|tired|exhausted|insomnia|nap|sleepy|awake)\b/i,
    chips: ["Honestly could use another night of that.", "Nah, I'll push through tonight."],
  },
  {
    match: /\b(food|ate|eating|cook|cooking|dinner|lunch|hungry|recipe|noodles?)\b/i,
    chips: ["I could genuinely eat right now.", "Let's keep it dead simple tonight."],
  },
  {
    match: /\b(music|song|playlist|spotify|album|listening)\b/i,
    chips: ["Put something with a bit of bounce on.", "Actually, keep it quiet tonight."],
  },
  {
    match: /\b(weekend|saturday|sunday|day off|off tomorrow)\b/i,
    chips: ["Saturday's completely wide open.", "Sunday's booked, Saturday's mine."],
  },
  {
    match: /\b(gym|run|running|walk|training|workout|exercise)\b/i,
    chips: ["Maybe a walk, not a full workout.", "I'd rather skip it today."],
  },
  {
    match: /\b(work|deadline|meeting|shift|project|code|deploy|bug|build)\b/i,
    chips: ["Yeah, that's the bit I keep putting off.", "Park it, it's not going anywhere."],
  },
];

const FALLBACK_DAILY = [
  "What's the best bit of your day so far?",
  "Tell me something good.",
  "What's actually on your mind?",
];

const FALLBACK_BUILDER = [
  "What's the next step on this?",
  "Show me the part that's actually failing.",
  "How would you test that?",
];

/** Replies that fit whatever E.V. just left open — derived locally, no extra
 * model call. Priority: answer the question he was actually left holding, one
 * topic continuation, a callback to the earlier thread, then a safe opener. */
export function deriveFollowUps(
  messages: ChatMessage[],
  mode: ChatMode,
): string[] {
  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
  if (!lastAssistant) return [];
  const reply = lastAssistant.content.trim();
  if (!reply) return [];
  const userTurns = messages.filter((m) => m.role === "user");
  const prompt = userTurns[userTurns.length - 1]?.content ?? "";
  const chips: string[] = [];

  const tail = reply.slice(-200);
  if (/\b(should i|want me|shall i|need me to|would you like|do you want)\b/i.test(tail)) {
    // He was offered something: answer the offer, not the topic.
    chips.push("Yeah, go ahead.", "Nah, leave it for now.", "Tell me a bit more first.");
  } else if (/\bhow are you\b|\bhow's it going\b|\bhow is it going\b/i.test(reply)) {
    chips.push("Better now, thanks.", "Honestly, kind of a day.");
  } else {
    const asked = lastQuestion(tail);
    // "X, or Y?" answers itself: the two sides are the two replies.
    const either = asked ? /^(.*?)(?:,\s*|\s+)or\s+([^,?]{3,60})\??$/i.exec(asked) : null;
    if (either) {
      const first = asSentence(either[1] ?? "");
      const second = asSentence(either[2] ?? "");
      if (first) chips.push(first);
      if (second) chips.push(second);
    } else if (asked) {
      // An open question: a soft non-answer keeps it alive without inventing.
      chips.push("Honestly, not sure yet.", "Ask me again in a minute.");
    }
  }

  // One continuation from the strongest matching topic — not a pile.
  const exchange = `${prompt} ${reply}`;
  for (const entry of TOPIC_FOLLOWUPS) {
    if (entry.match.test(exchange)) {
      chips.push(entry.chips[0] ?? "");
      break;
    }
  }

  // Callback to an earlier turn, when there is one worth returning to.
  const topic = topicWord(prompt) ?? topicWord(reply);
  const earlier = userTurns.slice(0, Math.max(userTurns.length - 1, 0)).reverse();
  for (const message of earlier) {
    const past = topicWord(message.content);
    if (past && past !== topic) {
      chips.push(`Let's go back to that ${past} thing.`);
      break;
    }
  }

  const fallback = mode === "builder" ? FALLBACK_BUILDER : FALLBACK_DAILY;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const chip of [...chips, ...fallback]) {
    const trimmed = chip.trim();
    // A chip cut off mid-sentence reads worse than no chip — drop the long ones.
    if (!trimmed || trimmed.length > 46) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
    if (out.length === 3) break;
  }
  return out;
}

/* ---------- speak-aloud (browser speech synthesis) ---------- */

const SPEAK_START_GRACE_MS = 1200;
const SPEAK_MAX_CHARS = 1400;

/** `defaultVoice` ships in Chromium but is missing from the DOM lib types. */
type SpeechEngine = SpeechSynthesis & { defaultVoice?: SpeechSynthesisVoice };

function synth(): SpeechEngine | null {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return null;
  return window.speechSynthesis as SpeechEngine;
}

/** Markdown, links and code read terribly aloud — strip before speaking. */
function stripForSpeech(text: string): string {
  const plain = text
    .replace(/```[\s\S]*?```/g, " (code block skipped) ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}([-*+]|\d+[.)])\s+/gm, "")
    .replace(/[*_>|#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (plain.length <= SPEAK_MAX_CHARS) return plain;
  const cut = plain.slice(0, SPEAK_MAX_CHARS);
  const sentence = cut.lastIndexOf(". ");
  return `${(sentence > SPEAK_MAX_CHARS * 0.5 ? cut.slice(0, sentence + 1) : cut).trim()} …`;
}

/** English first, local voices first — the usual Linux/Chromium shape. */
function voiceRank(voice: SpeechSynthesisVoice): number {
  const lang = voice.lang.toLowerCase();
  if (lang.startsWith("en-gb")) return 0;
  if (lang.startsWith("en-us")) return 1;
  if (lang.startsWith("en")) return 2;
  return 3;
}

/** Same ranking reapplied whenever the platform voice list changes. */
function sortVoices(list: SpeechSynthesisVoice[]): SpeechSynthesisVoice[] {
  return [...list].sort(
    (a, b) =>
      voiceRank(a) - voiceRank(b) ||
      Number(b.localService) - Number(a.localService) ||
      a.name.localeCompare(b.name),
  );
}

export interface SpeakControls {
  enabled: boolean;
  toggle: () => void;
  voices: SpeechSynthesisVoice[];
  voiceURI: string;
  pickVoice: (voiceURI: string) => void;
  /** Honest failure notice — speech is never silently dropped. */
  notice: string | null;
  clearNotice: () => void;
}

export interface SpeakAloud extends SpeakControls {
  /** Speak a finished assistant message once, keyed by its message id. */
  speak: (id: string, text: string) => void;
  /** Cut speech off immediately (send, unmount, navigation). */
  stop: () => void;
}

export function useSpeakAloud(): SpeakAloud {
  const { speakReplies, speakVoice, setSpeakReplies, setSpeakVoice } = useEv();
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>(() =>
    sortVoices(synth()?.getVoices() ?? []),
  );
  const [notice, setNotice] = useState<string | null>(null);
  const lastSpokenRef = useRef<string | null>(null);
  const enabledRef = useRef(speakReplies);
  const voiceURIRef = useRef(speakVoice);

  useEffect(() => {
    enabledRef.current = speakReplies;
  }, [speakReplies]);
  useEffect(() => {
    voiceURIRef.current = speakVoice;
  }, [speakVoice]);

  useEffect(() => {
    const engine = synth();
    if (!engine) return;
    const onVoicesChanged = () => setVoices(sortVoices(engine.getVoices()));
    engine.addEventListener("voiceschanged", onVoicesChanged);
    return () => {
      engine.removeEventListener("voiceschanged", onVoicesChanged);
      engine.cancel();
    };
  }, []);

  const stop = useCallback(() => {
    synth()?.cancel();
  }, []);

  // Barge-in: any typing cuts the reply off mid-sentence.
  useEffect(() => {
    if (!speakReplies) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key.length !== 1 && event.key !== "Enter" && event.key !== "Backspace") return;
      if (synth()?.speaking) synth()?.cancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [speakReplies]);

  const speak = useCallback((id: string, text: string) => {
    if (!enabledRef.current) return;
    if (lastSpokenRef.current === id) return;
    const engine = synth();
    if (!engine) {
      setNotice("Speak-aloud: this browser has no speech synthesis.");
      return;
    }
    if (engine.speaking || engine.pending) return;
    // In-band connection notices are status, not conversation — never read them.
    const body = stripForSpeech(text)
      .replace(/\s*\[E\.V\. (?:connection issue|timed out)[\s\S]*$/i, "")
      .trim();
    if (!body) return;
    lastSpokenRef.current = id;
    const utterance = new SpeechSynthesisUtterance(body);
    const picked =
      voices.find((v) => v.voiceURI === voiceURIRef.current) ??
      engine.defaultVoice ??
      undefined;
    if (picked) {
      utterance.voice = picked;
      utterance.lang = picked.lang;
    }
    let started = false;
    utterance.onstart = () => {
      started = true;
      setNotice(null);
    };
    utterance.onerror = () => {
      setNotice("Speak-aloud: the browser refused to play this one.");
    };
    engine.speak(utterance);
    // Chromium without a user gesture (or with no installed voice) never
    // starts; say so instead of pretending it spoke.
    window.setTimeout(() => {
      if (started || engine.speaking || engine.pending) return;
      engine.cancel();
      setNotice(
        voices.length === 0 && !engine.defaultVoice
          ? "Speak-aloud: no speech voice is installed on this system."
          : "Speak-aloud: blocked until you click or type once in this page.",
      );
    }, SPEAK_START_GRACE_MS);
  }, [voices]);

  const toggle = useCallback(() => {
    if (speakReplies) synth()?.cancel();
    void setSpeakReplies(!speakReplies);
    setNotice(null);
  }, [setSpeakReplies, speakReplies]);

  const pickVoice = useCallback(
    (voiceURI: string) => {
      void setSpeakVoice(voiceURI);
    },
    [setSpeakVoice],
  );

  const clearNotice = useCallback(() => setNotice(null), []);

  return useMemo<SpeakAloud>(
    () => ({
      enabled: speakReplies,
      toggle,
      voices,
      voiceURI: speakVoice,
      pickVoice,
      notice,
      clearNotice,
      speak,
      stop,
    }),
    [speakReplies, speakVoice, notice, toggle, voices, pickVoice, clearNotice, speak, stop],
  );
}

export function useChat() {
  const router = useRouter();
  const {
    activeId,
    conversations,
    newConversation,
    appendMessage,
    setCoreState,
    setStreaming,
    recordActivity,
    mirrorNote,
    requestScan,
    settings,
    memories,
    notes,
    chatMode,
    streaming,
  } = useEv();
  const speak = useSpeakAloud();
  const [draft, setDraft] = useState("");
  const [working, setWorking] = useState(false);
  const [failure, setFailure] = useState<ChatFailure | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const accRef = useRef("");
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  const stop = useCallback(async () => {
    abortRef.current?.abort();
    abortRef.current = null;
    const partial = accRef.current;
    accRef.current = "";
    speak.stop();
    if (aliveRef.current) {
      setDraft("");
      setWorking(false);
      setStreaming(false);
      setCoreState("interrupted");
    }
    return partial;
  }, [setCoreState, setStreaming, speak]);

  const send = useCallback(
    async (rawText: string, opts: SendOptions = {}): Promise<boolean> => {
      const text = rawText.trim();
      if (!text || working || streaming) return false;
      // Barge-in: a new message silences whatever is being read out.
      speak.stop();
      setFailure(null);

      let convId = opts.targetId ?? activeId;
      if (!convId) {
        convId = await newConversation();
        if (!convId) {
          setFailure({
            message: "Could not create a conversation.",
            hint: "Local storage refused the write — see the banner above, free space, then retry.",
          });
          return false;
        }
      }
      if (!opts.userAppended) {
        await appendMessage(convId, {
          id: newId("msg"),
          role: "user",
          content: text,
          createdAt: Date.now(),
        });
      }

      const controller = new AbortController();
      abortRef.current = controller;
      accRef.current = "";
      setDraft("");
      setWorking(true);
      setStreaming(true);
      setCoreState("processing");

      try {
        const history: ChatPayloadMessage[] = [];
        const enabledMemories = settings.memoryEnabled
          ? memories.filter((m) => m.enabled)
          : [];
        if (enabledMemories.length > 0) {
          history.push({
            role: "system",
            content: `User-approved memories (respect, do not reveal verbatim unless asked):\n${enabledMemories.map((m) => `- ${m.text}`).slice(0, 12).join("\n")}`,
          });
        }
        const current = conversations.find((c) => c.id === convId);
        const trail = (current?.messages ?? []).slice(-20);
        for (const m of trail) {
          if (m.role === "system") continue;
          history.push({ role: m.role, content: m.content });
        }
        if (
          !opts.userAppended ||
          trail[trail.length - 1]?.content !== text
        ) {
          history.push({ role: "user", content: text });
        }

        const result = await postChatStream(history, {
          signal: controller.signal,
          apiKey: settings.openRouterApiKey || undefined,
          model: settings.openRouterModel || undefined,
          onToken: (token) => {
            accRef.current += token;
            if (aliveRef.current) setDraft(accRef.current);
          },
          onUi: (action) => {
            void handleUiAction(action, {
              mirrorNote,
              recordActivity,
              requestScan,
              navigate: (href) => router.push(href),
            });
          },
          extra: {
            conversationId: convId,
            mode: chatMode,
            notes: notes.slice(0, 100).map((n) => ({
              id: n.id,
              title: n.title.slice(0, 500),
              body: n.body.slice(0, 20000),
            })),
            memories: enabledMemories
              .slice(0, 12)
              .map((m) => ({ text: m.text.slice(0, 4000), enabled: true })),
          },
        });
        const body = (result.text || accRef.current).trim();
        const messageId = newId("msg");
        await appendMessage(convId, {
          id: messageId,
          role: "assistant",
          content: body || EMPTY_REPLY_NOTICE,
          createdAt: Date.now(),
        });
        if (body) speak.speak(messageId, body);
        await recordActivity("chat", "Assistant reply recorded");
        if (aliveRef.current) {
          setCoreState("idle");
          setDraft("");
        }
        return true;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          const partial = accRef.current.trim();
          if (partial) {
            await appendMessage(convId, {
              id: newId("msg"),
              role: "assistant",
              content: `${partial}\n\n[Response stopped — partial text preserved.]`,
              createdAt: Date.now(),
            });
          }
          if (aliveRef.current) setCoreState("interrupted");
          return false;
        }
        if (aliveRef.current) {
          setCoreState("disconnected");
          if (error instanceof BackendUnavailableError) {
            setFailure({ message: error.message, hint: error.hint });
          } else {
            setFailure({
              message: error instanceof Error ? error.message : "Send failed.",
              hint: "Check the connection, then retry. Your text is preserved in the thread.",
            });
          }
        }
        return false;
      } finally {
        abortRef.current = null;
        accRef.current = "";
        if (aliveRef.current) {
          setWorking(false);
          setStreaming(false);
          setDraft("");
        }
      }
    },
    [
      working,
      streaming,
      activeId,
      conversations,
      newConversation,
      appendMessage,
      setCoreState,
      setStreaming,
      recordActivity,
      mirrorNote,
      requestScan,
      router,
      settings.memoryEnabled,
      settings.openRouterApiKey,
      settings.openRouterModel,
      memories,
      notes,
      chatMode,
      speak,
    ],
  );

  return { draft, working, failure, setFailure, send, stop, speak, chatMode };
}

/* ---------- thread ---------- */

function MessageActions({
  message,
  onRetry,
  retryLabel,
}: {
  message: ChatMessage;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="ev-msg-actions">
      <button
        type="button"
        className="ev-icon-btn"
        onClick={copy}
        aria-label={copied ? "Copied to clipboard" : "Copy message"}
      >
        {copied ? <Check /> : <Copy />}
        <span className="ev-icon-btn-label">{copied ? "Copied" : "Copy"}</span>
      </button>
      {onRetry && (
        <button
          type="button"
          className="ev-icon-btn"
          onClick={onRetry}
          aria-label={retryLabel ?? "Retry"}
        >
          <RefreshCw />
          <span className="ev-icon-btn-label">{retryLabel ?? "Retry"}</span>
        </button>
      )}
    </div>
  );
}

export function ChatThread({
  conversation,
  draft,
  working,
  onRetry,
  mode,
  onFollowUp,
}: {
  conversation: Conversation | null;
  draft: string;
  working: boolean;
  onRetry: (userText: string) => void;
  mode: ChatMode;
  onFollowUp: (text: string) => void;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const messages = useMemo(() => conversation?.messages ?? [], [conversation]);
  const streaming = Boolean(draft) || working;
  const followUps = useMemo(
    () => (streaming ? [] : deriveFollowUps(messages, mode)),
    [streaming, messages, mode],
  );
  const lastAssistantId = useMemo(
    () =>
      [...messages].reverse().find((m) => m.role === "assistant")?.id ?? null,
    [messages],
  );

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "auto", block: "end" });
  }, [messages.length, draft]);

  if (!conversation) return null;
  if (messages.length === 0 && !draft) return null;

  return (
    <div className="ev-thread" aria-live="polite">
      {messages.map((message, index) => (
        <article
          key={message.id}
          className={
            message.role === "user"
              ? "ev-msg ev-msg-user"
              : "ev-msg ev-msg-assistant"
          }
        >
          <header className="ev-msg-meta">
            <span>{message.role === "user" ? "Alfarez" : "E.V."}</span>
            <time className="ev-mono" dateTime={new Date(message.createdAt).toISOString()}>
              {new Date(message.createdAt).toLocaleString("en-GB", {
                day: "2-digit",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </time>
          </header>
          <div
            className={
              message.role === "user"
                ? "ev-bubble ev-bubble-user"
                : "ev-bubble ev-bubble-assistant"
            }
          >
            {message.role === "user" ? (
              <p>{message.content}</p>
            ) : (
              <MarkdownView text={message.content} />
            )}
          </div>
          <MessageActions
            message={message}
            onRetry={
              message.role === "assistant"
                ? () => {
                    const prior = [...messages.slice(0, index)]
                      .reverse()
                      .find((m) => m.role === "user");
                    if (prior) onRetry(prior.content);
                  }
                : undefined
            }
          />
          {message.id === lastAssistantId && followUps.length > 0 && (
            <footer className="ev-followup-row">
              {followUps.map((chip) => (
                <button
                  key={chip}
                  type="button"
                  className="ev-btn ev-btn-sm ev-btn-ghost ev-followup-chip"
                  onClick={() => onFollowUp(chip)}
                >
                  <CornerDownLeft aria-hidden="true" />
                  {chip}
                </button>
              ))}
            </footer>
          )}
        </article>
      ))}
      {draft && (
        <article className="ev-msg ev-msg-assistant ev-msg-streaming">
          <header className="ev-msg-meta">
            <span>E.V.</span>
            <div className="ev-streaming-indicator">
              <span className="ev-streaming-dot" aria-hidden="true" />
              <span>Streaming…</span>
            </div>
          </header>
          <div className="ev-bubble ev-bubble-assistant">
            <MarkdownView text={draft} />
          </div>
        </article>
      )}
      {working && !draft && (
        <article className="ev-msg ev-msg-assistant ev-msg-thinking">
          <header className="ev-msg-meta">
            <span>E.V.</span>
            <span className="ev-thinking-indicator">Thinking…</span>
          </header>
        </article>
      )}
      <div ref={bottomRef} />
    </div>
  );
}

/* ---------- composer controls: mode + speak-aloud ---------- */

const MODE_OPTIONS: { value: ChatMode; label: string; hint: string }[] = [
  {
    value: "daily",
    label: "Daily",
    hint: "Ordinary conversation — no system talk",
  },
  {
    value: "builder",
    label: "Builder",
    hint: "Technical answers — commands and tools welcome",
  },
];

export function ModeToggle({
  mode,
  onChange,
}: {
  mode: ChatMode;
  onChange: (mode: ChatMode) => void;
}) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const move = (from: number, delta: number) => {
    const nextIndex =
      (from + delta + MODE_OPTIONS.length) % MODE_OPTIONS.length;
    const option = MODE_OPTIONS[nextIndex];
    if (!option) return;
    onChange(option.value);
    buttons.current[nextIndex]?.focus();
  };
  return (
    <div
      role="radiogroup"
      aria-label="Chat mode"
      className="ev-mode-toggle"
    >
      {MODE_OPTIONS.map((option, index) => {
        const active = mode === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={`${option.label} — ${option.hint}`}
            title={option.hint}
            tabIndex={active ? 0 : -1}
            ref={(node) => {
              buttons.current[index] = node;
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight" || event.key === "ArrowDown") {
                event.preventDefault();
                move(index, 1);
              } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
                event.preventDefault();
                move(index, -1);
              }
            }}
            onClick={() => onChange(option.value)}
            className="ev-mode-toggle-btn"
            data-active={active ? "true" : "false"}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function ChatControls({ speak }: { speak: SpeakControls }) {
  const { chatMode, setChatMode } = useEv();
  return (
    <div className="ev-chat-controls">
      <ModeToggle mode={chatMode} onChange={(mode) => void setChatMode(mode)} />
      <div className="ev-speak-controls">
        <label className="ev-speak-toggle">
          <span className="ev-hint">Speak</span>
          <button
            type="button"
            role="switch"
            aria-checked={speak.enabled}
            aria-label="Read E.V.'s replies aloud"
            className="ev-switch"
            onClick={speak.toggle}
          />
        </label>
        {speak.enabled && speak.voices.length > 0 && (
          <select
            className="ev-input ev-voice-select"
            aria-label="Speak-aloud voice"
            value={speak.voiceURI}
            onChange={(event) => speak.pickVoice(event.target.value)}
          >
            <option value="">Default voice</option>
            {speak.voices.map((voice) => (
              <option key={voice.voiceURI} value={voice.voiceURI}>
                {voice.name} ({voice.lang})
              </option>
            ))}
          </select>
        )}
        {speak.enabled && speak.notice && (
          <span className="ev-hint" role="status">
            {speak.notice}
          </span>
        )}
      </div>
    </div>
  );
}

/* ---------- composer ---------- */

export function Composer({
  onSend,
  onStop,
  busy,
  placeholder = "Message E.V. — Enter to send, Shift+Enter for newline",
}: {
  onSend: (text: string) => void;
  onStop: () => void;
  busy: boolean;
  placeholder?: string;
}) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const MAX_CHARS = 4000;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const trimmed = value.trim();
      if (trimmed && !busy) {
        onSend(trimmed);
        setValue("");
      }
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    if (e.target.value.length <= MAX_CHARS) {
      setValue(e.target.value);
    }
  };

  const handleVoiceClick = () => router.push("/voice?auto=1");

  return (
    <div className="ev-composer">
      <div className="ev-composer-input-wrapper">
        <textarea
          ref={textareaRef}
          className="ev-textarea"
          placeholder={placeholder}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          disabled={busy}
          aria-label="Message E.V."
          rows={1}
          style={{ minHeight: 44, maxHeight: 200 }}
        />
        <div className="ev-composer-hint">
          <span className="ev-mono">{value.length}</span>/{MAX_CHARS}
        </div>
      </div>
      <div className="ev-composer-bar">
        <VoiceInput
          onStart={handleVoiceClick}
          onStop={() => undefined}
          className="ev-voice-btn"
        />
        <div className="ev-composer-actions">
          {busy ? (
            <button
              type="button"
              className="ev-btn ev-btn-primary ev-btn-sm"
              onClick={onStop}
              aria-label="Stop generation"
            >
              <Square className="h-4 w-4 fill-current" aria-hidden="true" />
              <span>Stop</span>
            </button>
          ) : (
            <button
              type="button"
              className="ev-btn ev-btn-primary ev-btn-sm"
              onClick={() => {
                const trimmed = value.trim();
                if (trimmed) {
                  onSend(trimmed);
                  setValue("");
                }
              }}
              disabled={!value.trim()}
              aria-label="Send message"
            >
              <ArrowUp className="h-4 w-4" aria-hidden="true" />
              <span>Send</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------- failure + disconnected notices ---------- */

export function ChatFailureNotice({
  failure,
  onRetry,
  onDismiss,
}: {
  failure: ChatFailure;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="ev-banner ev-banner-error" role="alert">
      <div className="ev-banner-content">
        <strong>{failure.message}</strong>
        <span>{failure.hint}</span>
      </div>
      <div className="ev-banner-actions">
        <button type="button" className="ev-btn ev-btn-sm" onClick={onRetry}>
          Retry
        </button>
        <button
          type="button"
          className="ev-btn ev-btn-sm ev-btn-ghost"
          onClick={onDismiss}
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}

export function ClearThreadButton({
  disabled,
  onClear,
}: {
  disabled: boolean;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="ev-btn ev-btn-ghost ev-btn-sm"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        Clear thread
      </button>
      <ConfirmDialog
        open={open}
        title="Clear this thread?"
        body="All messages in the current conversation will be permanently removed from this device. This cannot be undone."
        confirmText="Clear thread"
        danger
        onConfirm={() => {
          setOpen(false);
          onClear();
        }}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}
