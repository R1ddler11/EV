/* PROJECT E.V. — saved voice recordings (voice-owned).
   Lists recordings persisted in IndexedDB: play through an
   object URL revoked on stop / track end / unmount, rename
   inline, delete through the shared ConfirmDialog. One
   recording plays at a time. No motion — reduced-motion safe. */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Pause, Pencil, Play, Trash2 } from "lucide-react";
import { ConfirmDialog, SectionLabel, StatusPill } from "@/components/ui";
import {
  deleteRecording,
  listRecordings,
  PersistenceError,
  saveRecording,
} from "@/lib/db";
import type { Recording } from "@/lib/types";
import { formatDurationSec, formatSizeBytes } from "@/lib/voice-recording";

function fmtDate(ts: number): string {
  return new Date(ts).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Honest capture labels, keyed by the path that
 * produced the recording. */
const SOURCE_LABEL: Record<Recording["source"], string> = {
  realtime: "E.V.'s voice · realtime",
  "local-tts": "E.V.'s voice · text-to-speech",
};

interface SavedRecordingsProps {
  /** Bumped by the page after a save so the list reloads. */
  refreshSignal: number;
}

export default function SavedRecordings({ refreshSignal }: SavedRecordingsProps) {
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [playError, setPlayError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Recording | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  const stopPlayback = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.onended = null;
      audioRef.current.onerror = null;
      audioRef.current = null;
    }
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    setPlayingId(null);
  }, []);

  // Revoke the object URL when the list unmounts.
  useEffect(() => stopPlayback, [stopPlayback]);

  // Load on mount and whenever the page signals a new save.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const rows = await listRecordings();
        if (!active) return;
        setRecordings(rows);
        setLoadError(null);
      } catch (error) {
        if (!active) return;
        setLoadError(
          error instanceof PersistenceError
            ? error.message
            : "Recordings could not be loaded from this browser.",
        );
      } finally {
        if (active) setLoaded(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [refreshSignal]);

  /** Reload after a mutation (rename / delete). Event
   * handlers only — the mount load lives in the effect. */
  const refresh = useCallback(async () => {
    try {
      const rows = await listRecordings();
      setRecordings(rows);
      setLoadError(null);
    } catch (error) {
      setLoadError(
        error instanceof PersistenceError
          ? error.message
          : "Recordings could not be loaded from this browser.",
      );
    }
  }, []);

  const togglePlay = useCallback(
    (recording: Recording) => {
      if (playingId === recording.id) {
        stopPlayback();
        return;
      }
      stopPlayback();
      setPlayError(null);
      const url = URL.createObjectURL(recording.blob);
      const audio = new Audio(url);
      objectUrlRef.current = url;
      audioRef.current = audio;
      audio.onended = () => stopPlayback();
      audio.onerror = () => {
        setPlayError("This recording could not be played in this browser.");
        stopPlayback();
      };
      setPlayingId(recording.id);
      void audio.play().catch(() => {
        setPlayError("Playback was blocked — press play again.");
        stopPlayback();
      });
    },
    [playingId, stopPlayback],
  );

  const commitRename = useCallback(async () => {
    const target = recordings.find((row) => row.id === editingId);
    const clean = editTitle.trim();
    setEditingId(null);
    if (!target || !clean || clean === target.title) return;
    try {
      await saveRecording({ ...target, title: clean });
      await refresh();
    } catch (error) {
      setLoadError(
        error instanceof PersistenceError
          ? error.message
          : "The rename was not saved.",
      );
    }
  }, [editTitle, editingId, recordings, refresh]);

  const confirmDelete = useCallback(async () => {
    const target = deleteTarget;
    setDeleteTarget(null);
    if (!target) return;
    if (playingId === target.id) stopPlayback();
    try {
      await deleteRecording(target.id);
      await refresh();
    } catch (error) {
      setLoadError(
        error instanceof PersistenceError
          ? error.message
          : "The recording was not deleted.",
      );
    }
  }, [deleteTarget, playingId, refresh, stopPlayback]);

  return (
    <section className="ev-panel" aria-label="Saved recordings">
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
        }}
      >
        <SectionLabel>Saved recordings · {recordings.length}</SectionLabel>
        {recordings.length > 0 && (
          <span className="ev-hint">stored in this browser only</span>
        )}
      </div>
      <div
        style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}
      >
        {!loaded ? (
          <p className="ev-hint">Loading recordings…</p>
        ) : loadError ? (
          <div className="ev-banner" role="alert">
            <span>{loadError}</span>
          </div>
        ) : recordings.length === 0 ? (
          <div className="ev-empty">
            <span>No saved recordings yet.</span>
            <span className="ev-hint">
              Start a voice session and press Save recording while the link is
              live — the unsaved tail is discarded when the session ends.
            </span>
          </div>
        ) : (
          recordings.map((recording) => (
            <div className="ev-item" key={recording.id}>
              <div className="ev-item-head">
                <span className="ev-item-title">{recording.title}</span>
                <span
                  style={{ display: "flex", gap: 4, alignItems: "center" }}
                >
                  <span className="ev-item-time">
                    {fmtDate(recording.createdAt)} ·{" "}
                    {formatDurationSec(recording.durationSec)} ·{" "}
                    {formatSizeBytes(recording.sizeBytes)}
                  </span>
                  <button
                    type="button"
                    className="ev-icon-btn"
                    aria-label={
                      playingId === recording.id
                        ? `Stop ${recording.title}`
                        : `Play ${recording.title}`
                    }
                    onClick={() => togglePlay(recording)}
                  >
                    {playingId === recording.id ? (
                      <Pause size={13} />
                    ) : (
                      <Play size={13} />
                    )}
                  </button>
                  <button
                    type="button"
                    className="ev-icon-btn"
                    aria-label={`Rename ${recording.title}`}
                    onClick={() => {
                      setEditingId(recording.id);
                      setEditTitle(recording.title);
                    }}
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    type="button"
                    className="ev-icon-btn"
                    aria-label={`Delete ${recording.title}`}
                    onClick={() => setDeleteTarget(recording)}
                  >
                    <Trash2 size={13} />
                  </button>
                </span>
              </div>
              {editingId === recording.id ? (
                <div
                  style={{
                    display: "flex",
                    gap: 8,
                    marginTop: 8,
                    alignItems: "center",
                  }}
                >
                  <input
                    className="ev-input"
                    autoFocus
                    aria-label="Recording title"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void commitRename();
                      if (e.key === "Escape") setEditingId(null);
                    }}
                  />
                  <button
                    type="button"
                    className="ev-btn ev-btn-sm"
                    disabled={!editTitle.trim()}
                    onClick={() => void commitRename()}
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    className="ev-btn ev-btn-ghost ev-btn-sm"
                    onClick={() => setEditingId(null)}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <div
                  className="ev-item-body"
                  style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}
                >
                  <StatusPill tone="ok">
                    {SOURCE_LABEL[recording.source]}
                  </StatusPill>
                  <span className="ev-hint">{recording.mimeType}</span>
                  {playingId === recording.id && (
                    <span className="ev-hint" role="status">Playing…</span>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>
      {playError && (
        <div className="ev-banner" role="alert" style={{ marginTop: 10 }}>
          <span>{playError}</span>
        </div>
      )}
      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete this recording?"
        body={`“${deleteTarget?.title ?? ""}” will be permanently removed from this device. This cannot be undone.`}
        confirmText="Delete"
        danger
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleteTarget(null)}
      />
    </section>
  );
}
