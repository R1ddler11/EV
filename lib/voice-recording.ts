/* PROJECT E.V. — voice session recorder (frontend-owned).
   Captures E.V.'s voice only — the user's microphone is
   never recorded. Two capture paths, one per link mode:
   1. Realtime link: E.V.'s remote MediaStream (delivered
      by the peer connection, re-delivered after each
      session renewal) is mixed through an AudioContext
      into a MediaStreamDestination and recorded with
      MediaRecorder. Renewals swap the source node on the
      same destination, so the recorder keeps rolling.
   2. Local fallback: each spoken reply's TTS blob is
      appended and concatenated at snapshot time.
   The mimeType is probed (realtime path) or taken from
   the TTS blob (local path) and persisted with the
   recording so playback uses the exact container the
   audio was written with. Unsupported browsers are
   reported honestly — never a fake success. */

import type { RecordingSource } from "./types";

interface RecordingPiece {
  blob: Blob;
  durationSec: number;
}

interface RecordingSegment {
  blob: Blob;
  mimeType: string;
  durationSec: number;
  source: RecordingSource;
}

/** Container preference, most specific first; "" = browser default. */
const MIME_CANDIDATES: readonly string[] = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg",
];

/** Flush chunks to the encoder every second so long sessions
 * never hold the whole recording in memory. */
const SEGMENT_TIMESLICE_MS = 1000;

function pickMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  for (const candidate of MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(candidate)) return candidate;
  }
  return "";
}

function audioContextCtor(): typeof AudioContext | null {
  const win = window as unknown as { webkitAudioContext?: typeof AudioContext };
  return window.AudioContext ?? win.webkitAudioContext ?? null;
}

/** One live session's capture of E.V.'s voice.
 * attachRemote() starts (and keeps rolling through link
 * renewals) the realtime capture; appendReply() tees each
 * local-tts reply blob into the buffer; snapshot() cuts out
 * everything captured so far and the session stays captured
 * for the next save; dispose() discards the pending tail and
 * releases every browser resource. */
export class SessionRecorder {
  /** Local-tts reply blobs awaiting concatenation. */
  private pieces: RecordingPiece[] = [];
  private source: RecordingSource | null = null;
  /** Realtime-path state: one AudioContext + destination
   * for the whole session; the source node is swapped when
   * the link renews and delivers a fresh remote stream. */
  private ctx: AudioContext | null = null;
  private destination: MediaStreamAudioDestinationNode | null = null;
  private remoteStream: MediaStream | null = null;
  private remoteSources: MediaStreamAudioSourceNode[] = [];
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private segmentStartedAt = 0;
  private disposed = false;

  /** Which path produced audio so far, or null before
   * E.V. has spoken at all. */
  get currentSource(): RecordingSource | null {
    return this.source;
  }

  /** Audio captured so far, in seconds: wall-clock for the
   * realtime recorder, summed reply durations for local-tts. */
  get elapsedSec(): number {
    if (this.source === "realtime" && this.recorder) {
      return Math.max(0, (Date.now() - this.segmentStartedAt) / 1000);
    }
    let total = 0;
    for (const piece of this.pieces) {
      total += piece.durationSec;
    }
    return total;
  }

  /** Begin capturing E.V.'s remote track. Returns false when
   * the browser lacks AudioContext or MediaRecorder — the
   * caller must label that. Renewals re-call this with the
   * fresh stream; the recorder keeps rolling on the same
   * destination, with a brief silent gap during the swap. */
  attachRemote(stream: MediaStream): boolean {
    if (this.disposed) return false;
    if (stream === this.remoteStream) return this.recorder !== null;
    for (const source of this.remoteSources) {
      try {
        source.disconnect();
      } catch {
        /* already disconnected */
      }
    }
    this.remoteSources = [];
    this.remoteStream = stream;
    const Ctor = audioContextCtor();
    if (!Ctor || typeof MediaRecorder === "undefined") {
      this.remoteStream = null;
      return false;
    }
    try {
      if (!this.ctx) {
        this.ctx = new Ctor();
        void this.ctx.resume().catch(() => undefined);
      }
      if (!this.destination) {
        this.destination = this.ctx.createMediaStreamDestination();
      }
      const source = this.ctx.createMediaStreamSource(stream);
      source.connect(this.destination);
      this.remoteSources = [source];
      if (!this.recorder) this.beginSegment();
      if (!this.source) this.source = "realtime";
      return true;
    } catch {
      this.remoteStream = null;
      return false;
    }
  }

  /** Tee one local-tts reply blob into the capture buffer.
   * Its duration is read from the blob's audio metadata so
   * the saved recording's length is real, not estimated. */
  appendReply(blob: Blob): void {
    if (this.disposed || blob.size === 0) return;
    const piece: RecordingPiece = { blob, durationSec: 0 };
    this.pieces.push(piece);
    if (!this.source) this.source = "local-tts";
    this.readDuration(blob, piece);
  }

  private readDuration(blob: Blob, piece: RecordingPiece): void {
    if (typeof Audio === "undefined") return;
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.preload = "metadata";
    const cleanup = () => {
      URL.revokeObjectURL(url);
      audio.onloadedmetadata = null;
      audio.onerror = null;
    };
    audio.onloadedmetadata = () => {
      if (Number.isFinite(audio.duration)) piece.durationSec = audio.duration;
      cleanup();
    };
    audio.onerror = () => cleanup();
  }

  private beginSegment(): void {
    if (!this.destination) return;
    this.chunks = [];
    const mimeType = pickMimeType();
    this.recorder = new MediaRecorder(
      this.destination.stream,
      mimeType ? { mimeType } : undefined,
    );
    this.recorder.ondataavailable = (event) => {
      if (event.data.size > 0) this.chunks.push(event.data);
    };
    this.recorder.start(SEGMENT_TIMESLICE_MS);
    this.segmentStartedAt = Date.now();
  }

  /** Stop the current capture and return everything E.V.
   * said so far, then keep the session captured for the next
   * save. Returns null when nothing was captured yet. */
  async snapshot(): Promise<RecordingSegment | null> {
    if (this.disposed) return null;
    if (this.source === "realtime") {
      const recorder = this.recorder;
      if (!recorder || !this.destination) return null;
      const mimeType = recorder.mimeType;
      const durationSec = (Date.now() - this.segmentStartedAt) / 1000;
      await new Promise<void>((resolve) => {
        recorder.onstop = () => resolve();
        recorder.onerror = () => resolve();
        try {
          recorder.stop();
        } catch {
          resolve();
        }
      });
      this.recorder = null;
      const blob = new Blob(this.chunks, { type: mimeType || undefined });
      this.chunks = [];
      if (!this.disposed) this.beginSegment();
      if (blob.size === 0) return null;
      return {
        blob,
        mimeType: mimeType || blob.type,
        durationSec: Math.round(durationSec * 10) / 10,
        source: "realtime",
      };
    }
    // Local-tts path: concatenate the reply blobs.
    // Caveat: a stable provider means a stable container, and
    // Opus-in-WebM and MP3 both concatenate cleanly — but if
    // the TTS provider changes mid-session, playback may cut
    // at the boundary. The file stays honest to what was
    // spoken either way.
    if (this.pieces.length === 0) return null;
    const blobs = this.pieces.map((piece) => piece.blob);
    const durationSec = this.pieces.reduce(
      (total, piece) => total + piece.durationSec,
      0,
    );
    const mimeType = blobs[0]?.type ?? "";
    this.pieces = [];
    const blob = new Blob(blobs, { type: mimeType || undefined });
    if (blob.size === 0) return null;
    return {
      blob,
      mimeType: mimeType || blob.type,
      durationSec: Math.round(durationSec * 10) / 10,
      source: "local-tts",
    };
  }

  /** Stop capturing and release every browser resource. The
   * pending, unsaved audio is discarded — only snapshot()ed
   * segments survive. */
  dispose(): void {
    this.disposed = true;
    if (this.recorder) {
      try {
        this.recorder.stop();
      } catch {
        /* already stopped */
      }
      this.recorder = null;
    }
    for (const source of this.remoteSources) {
      try {
        source.disconnect();
      } catch {
        /* already disconnected */
      }
    }
    this.remoteSources = [];
    this.remoteStream = null;
    this.chunks = [];
    this.pieces = [];
    if (this.destination) {
      try {
        this.destination.disconnect();
      } catch {
        /* already disconnected */
      }
      this.destination = null;
    }
    if (this.ctx) {
      void this.ctx.close().catch(() => undefined);
      this.ctx = null;
    }
  }
}

/** "m:ss" for a duration in seconds. */
export function formatDurationSec(totalSeconds: number): string {
  const whole = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(whole / 60);
  const seconds = whole % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/** Human-readable byte size, so IndexedDB storage cost is visible. */
export function formatSizeBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
