/* PROJECT E.V. — realtime WebRTC voice client (frontend-owned).
   Manages a live OpenAI Realtime voice session over WebRTC:
   mic track → RTCPeerConnection → "oai-events" data channel → SDP offer
   POSTed to the realtime URL as text/sdp with Bearer clientSecret → SDP
   answer applied. Remote audio plays through a hidden <audio> element.
   The session is continuous: the server-side turn detector owns turn taking
   (semantic VAD with create_response + interrupt_response), so the mic stays
   hot and nothing is clicked between turns.

   Barge-in: while the model speaks, a detected speech start cancels the
   in-flight response (response.cancel), clears the server output buffer
   (output_audio_buffer.clear — WebRTC/SIP only, also truncates the
   conversation) and drops the remote audio immediately so no stale audio
   keeps playing. Over WebRTC the server owns the output buffer and performs
   the transcript truncation itself, so the client never guesses an
   audio_end_ms.

   Renewal: the ephemeral client secret expires. The session is re-minted
   through the caller-provided mint() and re-established over the same mic
   track at the next quiet point (or immediately when the backend reports an
   expired/dead session), carrying the recent transcript forward as real
   conversation items so nothing has to be re-explained.

   Every state the page renders comes from real data-channel events. The
   connection is never faked: failures surface through onState("error"). */

export type RealtimePhase =
  | "connecting"
  | "renewing"
  | "live"
  | "speaking"
  | "listening"
  | "processing"
  | "interrupted"
  | "ended"
  | "error";

export interface RealtimeRateLimit {
  name: string;
  limit?: number;
  remaining?: number;
  resetSeconds?: number;
}

/** One carried conversation turn, replayed into a replacement session. */
export interface RealtimeCarriedTurn {
  role: "user" | "assistant";
  text: string;
}

export interface RealtimeCallbacks {
  /** Progressive (final=false) or committed (final=true) transcript text. */
  onTranscript?: (
    text: string,
    final: boolean,
    speaker?: "user" | "assistant",
  ) => void;
  onState?: (phase: RealtimePhase, detail?: string) => void;
  /** Partial assistant answer cut short by barge-in (never a full answer). */
  onInterruption?: (partial: string) => void;
  /** E.V.'s own audio stream, for real output-level feedback. */
  onRemoteStream?: (stream: MediaStream) => void;
  onRateLimits?: (limits: RealtimeRateLimit[]) => void;
}

export interface RealtimeCredentials {
  clientSecret: string;
  realtimeUrl: string;
  dataChannel?: string;
  /** Unix seconds, as reported by the mint endpoint. */
  expiresAt?: number;
}

export interface RealtimeHandle {
  stop: () => void;
  /** Cancel the in-flight response and silence E.V. immediately. */
  interrupt: () => void;
  /** Inject a typed/wake-word question as a user turn and ask for an answer. */
  sendUserText: (text: string) => void;
  /** Enable/disable the outgoing mic track without dropping the session. */
  setMicEnabled: (enabled: boolean) => void;
}

/** Renew this long before the ephemeral secret expires. */
const RENEW_LEAD_MS = 60_000;
const RENEW_CHECK_MS = 15_000;
const MAX_RENEWALS = 3;
const DISCONNECT_GRACE_MS = 4_000;
const ICE_GATHER_TIMEOUT_MS = 10_000;
const CARRIED_TURN_LIMIT = 12;
const CARRIED_TURN_CHARS = 600;

interface SessionEvent {
  type?: string;
  delta?: string;
  transcript?: string;
  text?: string;
  item_id?: string;
  code?: string | null;
  message?: string;
  item?: {
    type?: string;
    id?: string;
    role?: string;
    status?: string;
    content?: Array<{ type?: string; text?: string }>;
  };
  response?: {
    id?: string;
    status?: string;
    status_details?: {
      reason?: string;
      error?: { message?: string; code?: string };
    };
  };
  error?: { message?: string; type?: string; code?: string | null };
  rate_limits?: RealtimeRateLimit[];
}

/** True when the backend is telling us the session/token is dead. */
function isExpirySignal(event: SessionEvent): boolean {
  const parts = [
    event.error?.code ?? event.code ?? "",
    event.error?.type ?? "",
    event.response?.status_details?.error?.code ?? "",
    event.error?.message ?? event.message ?? "",
  ]
    .join(" ")
    .toLowerCase();
  return (
    parts.includes("session_expired") ||
    parts.includes("invalid_token") ||
    parts.includes("token_expired") ||
    parts.includes("session has expired") ||
    parts.includes("invalid client secret")
  );
}

function errorText(event: SessionEvent, fallback: string): string {
  return event.error?.message ?? event.message ?? fallback;
}

/** Wait for ICE gathering so the POSTed SDP carries every candidate. */
function waitForIceGathering(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise<void>((resolve) => {
    const finish = () => {
      pc.removeEventListener("icegatheringstatechange", onChange);
      clearTimeout(timer);
      resolve();
    };
    const onChange = () => {
      if (pc.iceGatheringState === "complete") finish();
    };
    const timer = setTimeout(finish, ICE_GATHER_TIMEOUT_MS);
    pc.addEventListener("icegatheringstatechange", onChange);
  });
}

function failHttp(status: number): string {
  if (status === 401 || status === 403) {
    return "The realtime endpoint rejected the session secret. Ending and re-minting the voice link now.";
  }
  if (status === 429) {
    return "The realtime endpoint is rate-limited (HTTP 429). Wait ~30s, then retry the voice link.";
  }
  return `The realtime endpoint answered HTTP ${status}. Retry shortly.`;
}

export async function startRealtimeSession(
  opts: {
    /** Mints a fresh ephemeral secret (POST /api/voice/session). */
    mint: () => Promise<RealtimeCredentials>;
    stream: MediaStream;
    dataChannelName?: string;
  } & RealtimeCallbacks,
): Promise<RealtimeHandle> {
  const channelName = opts.dataChannelName ?? "oai-events";
  const micTracks = opts.stream.getAudioTracks();

  let pc: RTCPeerConnection | null = null;
  let channel: RTCDataChannel | null = null;
  let audioEl: HTMLAudioElement | null = null;
  let remoteStream: MediaStream | null = null;
  let generation = 0;
  let closed = false;
  let renewing = false;
  let renewals = 0;
  let expiresAtMs = 0;
  let speaking = false;
  let responseActive = false;
  let assistantPartial = "";
  let assistantItemId: string | null = null;
  let disconnectTimer: number | null = null;
  let checkTimer: number | null = null;
  const interruptedItems = new Set<string>();
  const carried: RealtimeCarriedTurn[] = [];
  const outbox: string[] = [];

  const emit = (phase: RealtimePhase, detail?: string) => {
    if (closed) return;
    opts.onState?.(phase, detail);
  };

  /** Send a client event, queueing until the data channel is open. */
  const send = (event: SessionEvent) => {
    const payload = JSON.stringify(event);
    if (channel && channel.readyState === "open") {
      channel.send(payload);
      return;
    }
    if (channel) {
      outbox.push(payload);
    }
  };

  const flushOutbox = () => {
    while (channel && channel.readyState === "open" && outbox.length > 0) {
      const next = outbox.shift();
      if (next) channel.send(next);
    }
  };

  const carry = (role: "user" | "assistant", text: string) => {
    const clean = text.trim();
    if (!clean) return;
    carried.push({ role, text: clean.slice(0, CARRIED_TURN_CHARS) });
    while (carried.length > CARRIED_TURN_LIMIT) carried.shift();
  };

  /** Drop the remote stream so buffered model audio stops instantly. */
  const silenceRemoteAudio = () => {
    if (audioEl) {
      audioEl.pause();
      audioEl.srcObject = null;
    }
  };

  const attachRemoteAudio = (stream: MediaStream) => {
    if (!audioEl) {
      audioEl = document.createElement("audio");
      audioEl.autoplay = true;
    }
    audioEl.srcObject = stream;
    void audioEl.play().catch(() => undefined);
  };

  const clearDisconnectTimer = () => {
    if (disconnectTimer !== null) {
      window.clearTimeout(disconnectTimer);
      disconnectTimer = null;
    }
  };

  const flushPartial = () => {
    const partial = assistantPartial.trim();
    assistantPartial = "";
    if (assistantItemId) interruptedItems.add(assistantItemId);
    assistantItemId = null;
    if (partial) opts.onInterruption?.(partial);
  };

  const interrupt = () => {
    if (closed) return;
    send({ type: "response.cancel" });
    send({ type: "output_audio_buffer.clear" });
    silenceRemoteAudio();
    speaking = false;
    if (assistantPartial.trim()) flushPartial();
    responseActive = false;
    emit("interrupted");
  };

  const replayCarried = () => {
    for (const turn of carried) {
      send({
        type: "conversation.item.create",
        item: {
          type: "message",
          role: turn.role,
          content: [
            {
              type: turn.role === "user" ? "input_text" : "text",
              text: turn.text,
            },
          ],
        },
      });
    }
  };

  const teardownConnection = () => {
    generation += 1;
    clearDisconnectTimer();
    outbox.length = 0;
    try {
      channel?.close();
    } catch {
      /* already closed */
    }
    try {
      pc?.close();
    } catch {
      /* already closed */
    }
    channel = null;
    pc = null;
    silenceRemoteAudio();
    remoteStream = null;
    speaking = false;
    responseActive = false;
  };

  const handleEvent = (event: SessionEvent) => {
    switch (event.type) {
      case "session.created":
      case "conversation.created":
        if (opts.stream.active) emit("listening");
        return;

      case "session.updated":
        if (opts.stream.active) emit("listening");
        return;

      case "rate_limits.updated":
        if (event.rate_limits?.length) opts.onRateLimits?.(event.rate_limits);
        return;

      case "input_audio_buffer.speech_started": {
        if (speaking || assistantPartial) {
          // Barge-in: the model is mid-answer, so cut it off now.
          interrupt();
          return;
        }
        emit("listening");
        return;
      }

      case "input_audio_buffer.speech_stopped":
      case "input_audio_buffer.timeout_triggered":
        emit("processing");
        return;

      case "response.created":
        responseActive = true;
        emit("processing");
        return;

      case "response.output_audio_transcript.delta":
      case "response.output_text.delta": {
        if (typeof event.delta === "string" && event.delta) {
          assistantPartial += event.delta;
          assistantItemId = event.item_id ?? assistantItemId;
          opts.onTranscript?.(event.delta, false, "assistant");
        }
        return;
      }

      case "response.output_audio_transcript.done":
      case "response.output_text.done": {
        const text = (event.transcript ?? "").trim();
        const itemId = event.item_id ?? assistantItemId;
        assistantPartial = "";
        assistantItemId = null;
        if (itemId && interruptedItems.has(itemId)) {
          interruptedItems.delete(itemId);
          return;
        }
        if (text) {
          carry("assistant", text);
          opts.onTranscript?.(text, true, "assistant");
        }
        return;
      }

      case "conversation.item.input_audio_transcription.delta":
        if (event.delta) opts.onTranscript?.(event.delta, false, "user");
        return;

      case "conversation.item.input_audio_transcription.completed": {
        const text = (event.transcript ?? "").trim();
        if (text) {
          carry("user", text);
          opts.onTranscript?.(text, true, "user");
        }
        return;
      }

      case "conversation.item.input_audio_transcription.failed":
        emit(
          "error",
          `Your last utterance could not be transcribed (${errorText(event, "unknown error")}). E.V. heard audio but has no text for it — repeat that line.`,
        );
        return;

      case "output_audio_buffer.started":
        speaking = true;
        responseActive = true;
        if (remoteStream) attachRemoteAudio(remoteStream);
        emit("speaking");
        return;

      case "output_audio_buffer.stopped":
        speaking = false;
        if (opts.stream.active) emit("listening");
        return;

      case "output_audio_buffer.cleared":
        silenceRemoteAudio();
        speaking = false;
        return;

      case "response.done": {
        responseActive = false;
        speaking = false;
        const status = event.response?.status;
        const details = event.response?.status_details;
        if (status === "failed") {
          emit(
            "error",
            `E.V.'s answer failed (${details?.error?.code ?? "unknown"}) — ${details?.error?.message ?? "the realtime service reported no reason"}. Try again.`,
          );
          return;
        }
        if (status === "cancelled") {
          flushPartial();
          emit(
            "interrupted",
            details?.reason === "turn_detected"
              ? "You talked over E.V., so that answer was cut off."
              : "That answer was cancelled.",
          );
          return;
        }
        if (status === "incomplete") {
          emit(
            "error",
            details?.reason === "content_filter"
              ? "E.V.'s answer was stopped by the safety filter. Rephrase and try again."
              : "E.V.'s answer hit the response length limit and was cut short. Ask for the rest.",
          );
          return;
        }
        flushPartial();
        if (opts.stream.active) emit("listening");
        return;
      }

      case "error": {
        const detail = errorText(event, "Realtime session error.");
        if (isExpirySignal(event)) {
          void renew(`The voice session credential expired (${detail})`);
          return;
        }
        emit("error", detail);
        return;
      }

      default:
        return;
    }
  };

  const connect = async (
    credentials: RealtimeCredentials,
    replay: boolean,
  ): Promise<void> => {
    const gen = (generation += 1);
    const conn = new RTCPeerConnection();
    pc = conn;
    const dc = conn.createDataChannel(channelName);
    channel = dc;

    for (const track of opts.stream.getTracks()) {
      conn.addTrack(track, opts.stream);
    }

    dc.onopen = () => {
      if (gen !== generation || closed) return;
      flushOutbox();
      if (replay) replayCarried();
    };
    dc.onmessage = (msg: MessageEvent<string>) => {
      if (gen !== generation || closed) return;
      let event: SessionEvent | null = null;
      try {
        event = JSON.parse(msg.data) as SessionEvent;
      } catch {
        return;
      }
      if (event) handleEvent(event);
    };
    dc.onerror = () => {
      if (gen !== generation || closed) return;
      emit("error", "The realtime data channel failed. Re-establishing the voice link.");
      void renew("The realtime data channel failed.");
    };

    conn.ontrack = (e: RTCTrackEvent) => {
      if (gen !== generation || closed) return;
      const stream = e.streams[0] ?? new MediaStream([e.track]);
      remoteStream = stream;
      attachRemoteAudio(stream);
      opts.onRemoteStream?.(stream);
    };

    conn.onconnectionstatechange = () => {
      if (gen !== generation || closed) return;
      const state = conn.connectionState;
      clearDisconnectTimer();
      if (state === "connected") {
        emit("live");
        return;
      }
      if (state === "failed" || state === "closed") {
        void renew(`Peer connection ${state}.`);
        return;
      }
      if (state === "disconnected") {
        disconnectTimer = window.setTimeout(() => {
          disconnectTimer = null;
          if (conn.connectionState !== "connected" && !closed) {
            void renew("The peer connection dropped and did not recover.");
          }
        }, DISCONNECT_GRACE_MS);
      }
    };

    emit("connecting");
    const offer = await conn.createOffer({ offerToReceiveAudio: true });
    await conn.setLocalDescription(offer);
    await waitForIceGathering(conn);
    const localDescription = conn.localDescription;
    if (!localDescription) {
      throw new Error(
        "Could not create a local audio offer for the realtime session.",
      );
    }

    let sdpResponse: Response;
    try {
      sdpResponse = await fetch(credentials.realtimeUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${credentials.clientSecret}`,
          "Content-Type": "application/sdp",
        },
        body: localDescription.sdp,
      });
    } catch {
      throw new Error(
        "Could not reach the realtime voice endpoint (network failure). Check the connection, then retry.",
      );
    }
    if (!sdpResponse.ok) throw new Error(failHttp(sdpResponse.status));
    const answerSdp = await sdpResponse.text();
    if (!answerSdp) {
      throw new Error("The realtime endpoint returned an empty session answer.");
    }
    if (gen !== generation || closed) return;
    await conn.setRemoteDescription({ type: "answer", sdp: answerSdp });
    expiresAtMs = credentials.expiresAt ? credentials.expiresAt * 1000 : 0;
    emit("listening");
  };

  async function renew(reason: string): Promise<void> {
    if (closed || renewing) return;
    renewing = true;
    teardownConnection();
    emit("renewing", reason);
    if (renewals >= MAX_RENEWALS) {
      renewing = false;
      emit(
        "error",
        "The voice link could not be re-established after several attempts. End the session and start again; your transcript is preserved.",
      );
      return;
    }
    renewals += 1;
    let credentials: RealtimeCredentials;
    try {
      credentials = await opts.mint();
    } catch (error) {
      renewing = false;
      emit(
        "error",
        `Renewing the voice link failed: ${
          error instanceof Error ? error.message : "the session endpoint is unavailable"
        }. The conversation so far is kept — retry from this page.`,
      );
      return;
    }
    if (closed) {
      renewing = false;
      return;
    }
    try {
      await connect(credentials, carried.length > 0);
    } catch (error) {
      renewing = false;
      emit(
        "error",
        `Renewing the voice link failed: ${
          error instanceof Error ? error.message : "the realtime endpoint refused the new session"
        }. The conversation so far is kept — retry from this page.`,
      );
      return;
    }
    renewing = false;
    emit(
      "listening",
      `Voice link renewed (attempt ${renewals}); ${carried.length} earlier turn${
        carried.length === 1 ? "" : "s"
      } carried over.`,
    );
  }

  /** Renew at a quiet point shortly before the ephemeral secret expires. */
  const scheduleRenewalChecks = () => {
    if (checkTimer !== null) window.clearInterval(checkTimer);
    checkTimer = window.setInterval(() => {
      if (closed || renewing || !expiresAtMs) return;
      if (Date.now() < expiresAtMs - RENEW_LEAD_MS) return;
      if (speaking || responseActive || assistantPartial) return;
      void renew("Renewing the voice session before its credential expires.");
    }, RENEW_CHECK_MS);
  };

  let credentials: RealtimeCredentials;
  try {
    credentials = await opts.mint();
  } catch (error) {
    throw error instanceof Error
      ? error
      : new Error("The voice session could not be started.");
  }
  try {
    await connect(credentials, false);
  } catch (error) {
    teardownConnection();
    throw error instanceof Error
      ? error
      : new Error("The realtime voice session could not be established.");
  }
  scheduleRenewalChecks();

  return {
    stop() {
      if (closed) return;
      closed = true;
      if (checkTimer !== null) {
        window.clearInterval(checkTimer);
        checkTimer = null;
      }
      teardownConnection();
      outbox.length = 0;
      for (const track of micTracks) track.enabled = true;
      opts.onState?.("ended");
    },
    interrupt() {
      interrupt();
    },
    sendUserText(text: string) {
      const clean = text.trim();
      if (!clean || closed) return;
      send({
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: clean }],
        },
      });
      send({ type: "response.create" });
    },
    setMicEnabled(enabled: boolean) {
      for (const track of micTracks) track.enabled = enabled;
    },
  };
}