/* PROJECT E.V. — Memory & Activity vault (frontend-owned).
   Notes, conversation history links, user-approved memories with full
   inspect/edit/remove/disable + clear-all confirms, settings describing
   memory use, search/filter everywhere. All IndexedDB-persisted. */
"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Pencil, Plus, Search, Trash2 } from "lucide-react";
import { SectionLabel, ConfirmDialog } from "@/components/ui";
import { useEv } from "@/lib/store";

function fmt(ts: number): string {
  return new Date(ts).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function MemoryPage() {
  const {
    notes,
    addNote,
    updateNote,
    removeNote,
    conversations,
    removeConversation,
    clearAllConversations,
    memories,
    addMemory,
    updateMemory,
    removeMemory,
    clearAllMemories,
    settings,
    updateSettings,
    activity,
    clearAllActivity,
  } = useEv();

  const [query, setQuery] = useState("");
  const [noteTitle, setNoteTitle] = useState("");
  const [noteBody, setNoteBody] = useState("");
  const [editingNote, setEditingNote] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editBody, setEditBody] = useState("");
  const [memoryInput, setMemoryInput] = useState("");
  const [editingMemory, setEditingMemory] = useState<string | null>(null);
  const [editMemoryText, setEditMemoryText] = useState("");
  const [confirm, setConfirm] = useState<
    null | "memories" | "conversations" | "activity"
  >(null);
  const [deleteNoteId, setDeleteNoteId] = useState<string | null>(null);
  const [deleteConvId, setDeleteConvId] = useState<string | null>(null);
  const [deleteMemId, setDeleteMemId] = useState<string | null>(null);

  const q = query.trim().toLowerCase();
  const shownNotes = useMemo(
    () =>
      q
        ? notes.filter(
            (n) =>
              n.title.toLowerCase().includes(q) ||
              n.body.toLowerCase().includes(q),
          )
        : notes,
    [notes, q],
  );
  const shownMemories = useMemo(
    () => (q ? memories.filter((m) => m.text.toLowerCase().includes(q)) : memories),
    [memories, q],
  );
  const shownActivity = useMemo(
    () =>
      q
        ? activity.filter(
            (a) =>
              a.label.toLowerCase().includes(q) ||
              (a.detail ?? "").toLowerCase().includes(q),
          )
        : activity,
    [activity, q],
  );

  return (
    <div className="ev-stack">
      <header className="ev-page-head">
        <SectionLabel>E.V. // Memory Vault</SectionLabel>
        <h1 className="ev-h1">Memory & activity</h1>
        <p className="ev-lede">
          Everything here lives in your browser (IndexedDB) — conversations,
          notes, approved memories. Nothing syncs anywhere; delete anything,
          any time.
        </p>
        <div className="ev-search" style={{ maxWidth: 420 }}>
          <Search />
          <input
            className="ev-input"
            aria-label="Search the vault"
            placeholder="Search notes, memories, activity…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </header>

      <section className="ev-panel" aria-label="Memory controls">
        <SectionLabel>How Memory Works</SectionLabel>
        <p className="ev-lede" style={{ fontSize: 13.5, marginTop: 6 }}>
          E.V. remembers only what you approve below — each entry is stored
          verbatim and can be inspected, edited, disabled, or removed. When
          memory is on, enabled entries are attached to new requests as
          background context. Disabling memory stops all of that instantly;
          existing entries stay until you delete them.
        </p>
        <div className="ev-toggle">
          <span>
            <strong>Use approved memories as context</strong>
            <br />
            <span className="ev-hint">Enabled entries ride along with chat requests.</span>
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={settings.memoryEnabled}
            aria-label="Toggle memory context"
            className="ev-switch"
            onClick={() => void updateSettings({ memoryEnabled: !settings.memoryEnabled })}
          />
        </div>
        <div className="ev-toggle">
          <span>
            <strong>Save voice transcripts to history</strong>
            <br />
            <span className="ev-hint">Off means dictation vanishes when the session ends.</span>
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={settings.transcriptPersistence}
            aria-label="Toggle transcript persistence"
            className="ev-switch"
            onClick={() =>
              void updateSettings({ transcriptPersistence: !settings.transcriptPersistence })
            }
          />
        </div>
        <div className="ev-toggle">
          <span>
            <strong>Motion</strong>
            <br />
            <span className="ev-hint">System follows your OS reduced-motion setting.</span>
          </span>
          <select
            className="ev-input"
            style={{ width: "auto" }}
            aria-label="Motion preference"
            value={settings.reducedMotionOverride}
            onChange={(e) =>
              void updateSettings({
                reducedMotionOverride: e.target.value as typeof settings.reducedMotionOverride,
              })
            }
          >
            <option value="system">Follow system</option>
            <option value="reduce">Reduce motion</option>
            <option value="full">Full motion</option>
          </select>
        </div>
      </section>

      <section className="ev-panel" aria-label="Approved memories">
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
          <SectionLabel>Approved Memories · {memories.length}</SectionLabel>
          {memories.length > 0 && (
            <button type="button" className="ev-icon-btn" onClick={() => setConfirm("memories")}>
              <Trash2 size={13} /> Clear all
            </button>
          )}
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <input
            className="ev-input"
            aria-label="New memory"
            placeholder="Approve a memory — e.g. “Alfarez prefers concise morning briefings”"
            value={memoryInput}
            onChange={(e) => setMemoryInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && memoryInput.trim()) {
                void addMemory(memoryInput);
                setMemoryInput("");
              }
            }}
          />
          <button
            type="button"
            className="ev-btn ev-btn-primary ev-btn-sm"
            disabled={!memoryInput.trim()}
            onClick={() => {
              void addMemory(memoryInput);
              setMemoryInput("");
            }}
          >
            <Plus /> Approve
          </button>
        </div>
        <div className="ev-stack" style={{ marginTop: 12, gap: 10 }}>
          {shownMemories.length === 0 ? (
            <div className="ev-empty">
              <span>{q ? "No memories match." : "No approved memories yet."}</span>
              <span className="ev-hint">Approve one above — it stays until you remove it.</span>
            </div>
          ) : (
            shownMemories.map((m) => (
              <div className="ev-item" key={m.id} style={{ opacity: m.enabled ? 1 : 0.6 }}>
                <div className="ev-item-head">
                  <span className="ev-item-time">
                    {fmt(m.createdAt)} · user-approved · {m.enabled ? "active" : "disabled"}
                  </span>
                  <span style={{ display: "flex", gap: 4 }}>
                    <button
                      type="button"
                      className="ev-icon-btn"
                      aria-label={m.enabled ? `Disable memory ${m.id}` : `Enable memory ${m.id}`}
                      onClick={() => void updateMemory(m.id, m.text, !m.enabled)}
                    >
                      {m.enabled ? "Disable" : "Enable"}
                    </button>
                    <button
                      type="button"
                      className="ev-icon-btn"
                      aria-label={`Edit memory ${m.id}`}
                      onClick={() => {
                        setEditingMemory(m.id);
                        setEditMemoryText(m.text);
                      }}
                    >
                      <Pencil />
                    </button>
                    <button
                      type="button"
                      className="ev-icon-btn"
                      aria-label={`Delete memory ${m.id}`}
                      onClick={() => setDeleteMemId(m.id)}
                    >
                      <Trash2 />
                    </button>
                  </span>
                </div>
                {editingMemory === m.id ? (
                  <div style={{ display: "flex", gap: 8 }}>
                    <input
                      className="ev-input"
                      autoFocus
                      aria-label="Edit memory text"
                      value={editMemoryText}
                      onChange={(e) => setEditMemoryText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && editMemoryText.trim()) {
                          void updateMemory(m.id, editMemoryText.trim(), m.enabled);
                          setEditingMemory(null);
                        }
                        if (e.key === "Escape") setEditingMemory(null);
                      }}
                    />
                    <button
                      type="button"
                      className="ev-btn ev-btn-sm"
                      disabled={!editMemoryText.trim()}
                      onClick={() => {
                        void updateMemory(m.id, editMemoryText.trim(), m.enabled);
                        setEditingMemory(null);
                      }}
                    >
                      Save
                    </button>
                  </div>
                ) : (
                  <p className="ev-item-body">{m.text}</p>
                )}
              </div>
            ))
          )}
        </div>
      </section>

      <section className="ev-panel" aria-label="Notes">
        <SectionLabel>Notes · {notes.length}</SectionLabel>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
          <input
            className="ev-input"
            aria-label="Note title"
            placeholder="Note title"
            value={noteTitle}
            onChange={(e) => setNoteTitle(e.target.value)}
          />
          <textarea
            className="ev-textarea"
            aria-label="Note body"
            placeholder="Write a note…"
            rows={3}
            value={noteBody}
            onChange={(e) => setNoteBody(e.target.value)}
          />
          <div>
            <button
              type="button"
              className="ev-btn ev-btn-sm"
              disabled={!noteBody.trim() && !noteTitle.trim()}
              onClick={() => {
                void addNote(noteTitle, noteBody);
                setNoteTitle("");
                setNoteBody("");
              }}
            >
              <Plus /> Save note
            </button>
          </div>
        </div>
        <div className="ev-stack" style={{ marginTop: 12, gap: 10 }}>
          {shownNotes.length === 0 ? (
            <div className="ev-empty">
              <span>{q ? "No notes match." : "No notes yet."}</span>
              <span className="ev-hint">Notes persist locally across reloads.</span>
            </div>
          ) : (
            shownNotes.map((note) => (
              <div className="ev-item" key={note.id}>
                <div className="ev-item-head">
                  <span className="ev-item-title">{note.title}</span>
                  <span style={{ display: "flex", gap: 4, alignItems: "center" }}>
                    <span className="ev-item-time">{fmt(note.updatedAt)}</span>
                    <button
                      type="button"
                      className="ev-icon-btn"
                      aria-label={`Edit note ${note.title}`}
                      onClick={() => {
                        setEditingNote(note.id);
                        setEditTitle(note.title);
                        setEditBody(note.body);
                      }}
                    >
                      <Pencil />
                    </button>
                    <button
                      type="button"
                      className="ev-icon-btn"
                      aria-label={`Delete note ${note.title}`}
                      onClick={() => setDeleteNoteId(note.id)}
                    >
                      <Trash2 />
                    </button>
                  </span>
                </div>
                {editingNote === note.id ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <input
                      className="ev-input"
                      aria-label="Edit note title"
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                    />
                    <textarea
                      className="ev-textarea"
                      aria-label="Edit note body"
                      rows={3}
                      value={editBody}
                      onChange={(e) => setEditBody(e.target.value)}
                    />
                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        type="button"
                        className="ev-btn ev-btn-sm"
                        onClick={() => {
                          void updateNote(note.id, editTitle, editBody);
                          setEditingNote(null);
                        }}
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        className="ev-btn ev-btn-ghost ev-btn-sm"
                        onClick={() => setEditingNote(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="ev-item-body">{note.body || "—"}</p>
                )}
              </div>
            ))
          )}
        </div>
      </section>

      <div className="ev-grid-2">
        <section className="ev-panel" aria-label="Conversation history">
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
            <SectionLabel>Conversations · {conversations.length}</SectionLabel>
            {conversations.length > 0 && (
              <button type="button" className="ev-icon-btn" onClick={() => setConfirm("conversations")}>
                <Trash2 size={13} /> Clear all
              </button>
            )}
          </div>
          <div style={{ marginTop: 8 }}>
            {conversations.length === 0 ? (
              <div className="ev-empty">
                <span>No conversations stored.</span>
                <Link href="/assistant" className="ev-btn ev-btn-sm">Start one</Link>
              </div>
            ) : (
              conversations.slice(0, 8).map((conv) => (
                <div className="ev-activity-row" key={conv.id}>
                  <span className="ev-mono" style={{ fontSize: 10.5, color: "#5b6470", flex: "none" }}>
                    {fmt(conv.updatedAt)}
                  </span>
                  <Link href="/assistant" style={{ fontWeight: 600, fontSize: 13 }}>
                    {conv.title}
                  </Link>
                  <span className="ev-hint">· {conv.messages.length} msgs</span>
                  <button
                    type="button"
                    className="ev-icon-btn"
                    aria-label={`Delete ${conv.title}`}
                    style={{ marginLeft: "auto" }}
                    onClick={() => setDeleteConvId(conv.id)}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="ev-panel" aria-label="Activity log">
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
            <SectionLabel>Activity · {activity.length}</SectionLabel>
            {activity.length > 0 && (
              <button type="button" className="ev-icon-btn" onClick={() => setConfirm("activity")}>
                <Trash2 size={13} /> Clear
              </button>
            )}
          </div>
          <div style={{ marginTop: 8, maxHeight: 320, overflowY: "auto" }}>
            {shownActivity.length === 0 ? (
              <div className="ev-empty">
                <span>{q ? "No activity matches." : "No activity recorded."}</span>
              </div>
            ) : (
              shownActivity.slice(0, 30).map((entry) => (
                <div className="ev-activity-row" key={entry.id}>
                  <span className="ev-mono" style={{ fontSize: 10.5, color: "#5b6470", flex: "none" }}>
                    {fmt(entry.at)}
                  </span>
                  <span style={{ fontSize: 13 }}>
                    <strong style={{ fontWeight: 600 }}>{entry.label}</strong>
                    {entry.detail && <span style={{ color: "#8d99a6" }}> — {entry.detail}</span>}
                  </span>
                </div>
              ))
            )}
          </div>
        </section>
      </div>

      <ConfirmDialog
        open={confirm !== null}
        title={
          confirm === "memories"
            ? "Delete all approved memories?"
            : confirm === "conversations"
              ? "Delete all conversations?"
              : "Clear the activity log?"
        }
        body="This permanently removes the selected data from this device and cannot be undone."
        confirmText={confirm === "activity" ? "Clear log" : "Delete all"}
        danger
        onConfirm={() => {
          if (confirm === "memories") void clearAllMemories();
          if (confirm === "conversations") void clearAllConversations();
          if (confirm === "activity") void clearAllActivity();
          setConfirm(null);
        }}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={deleteNoteId !== null}
        title="Delete this note?"
        body="The note will be permanently removed from this device."
        confirmText="Delete"
        danger
        onConfirm={() => {
          if (deleteNoteId) void removeNote(deleteNoteId);
          setDeleteNoteId(null);
        }}
        onCancel={() => setDeleteNoteId(null)}
      />
      <ConfirmDialog
        open={deleteConvId !== null}
        title="Delete this conversation?"
        body="The conversation and its messages will be permanently removed."
        confirmText="Delete"
        danger
        onConfirm={() => {
          if (deleteConvId) void removeConversation(deleteConvId);
          setDeleteConvId(null);
        }}
        onCancel={() => setDeleteConvId(null)}
      />
      <ConfirmDialog
        open={deleteMemId !== null}
        title="Delete this memory?"
        body="E.V. will no longer use it as context."
        confirmText="Delete"
        danger
        onConfirm={() => {
          if (deleteMemId) void removeMemory(deleteMemId);
          setDeleteMemId(null);
        }}
        onCancel={() => setDeleteMemId(null)}
      />
    </div>
  );
}
