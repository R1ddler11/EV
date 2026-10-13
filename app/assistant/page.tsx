/* PROJECT E.V. — Assistant area (frontend-owned).
   Streaming thread, history list with search/filter, new conversation,
   rename, delete, copy/retry/stop, clear-thread confirm, suggested prompts,
   chat-mode toggle (daily/builder), speak-aloud controls and locally derived
   follow-up chips. Integrated with the dashboard: shares the store, core
   state and activity. Split view on desktop, drawer on mobile. */
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { MessageSquarePlus, Search, Trash2, Menu, X } from "lucide-react";
import { SectionLabel, ConfirmDialog } from "@/components/ui";
import CloudPill from "@/components/cloud-pill";
import {
  ChatControls,
  ChatFailureNotice,
  ChatThread,
  ClearThreadButton,
  Composer,
  useChat,
} from "@/components/chat";
import MorphOrb from "@/components/ui/ai-thiking-orb-and-input";
import { useEv } from "@/lib/store";
import { useOrbTurn } from "@/lib/use-orb-turn";

function AssistantInner() {
  const router = useRouter();
  const params = useSearchParams();
  const {
    ready,
    active,
    activeId,
    conversations,
    newConversation,
    selectConversation,
    renameConversation,
    removeConversation,
    backendReachable,
    backendHint,
    coreState,
    chatMode,
  } = useEv();
  const { draft, working, failure, setFailure, send, stop, speak } = useChat();
  const [query, setQuery] = useState("");
  const [lastSent, setLastSent] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // The ask surface (shared hook): the orb owns the empty
  // state and stays mounted through its own turn so the
  // answer card can show E.V.'s real reply.

  useEffect(() => {
    if (!ready) return;
    const id = params.get("conversation");
    if (id) {
      selectConversation(id);
      return;
    }
    if (conversations.length === 0) {
      void newConversation();
    }
  }, [params, ready, newConversation, router, selectConversation, conversations.length]);

  const filtered = useMemo(() => {
    if (!query.trim()) return conversations;
    const q = query.toLowerCase();
    return conversations.filter((c) =>
      c.title.toLowerCase().includes(q) ||
      c.messages.some((m) => m.content.toLowerCase().includes(q))
    );
  }, [conversations, query]);

  const doSend = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setLastSent(trimmed);
    const target = activeId ?? undefined;
    await send(trimmed, { targetId: target });
  };

  // The ask-surface turn, shared with the home hero: the
  // hook owns conversation creation, turn persistence and
  // the honest error strings; the returned text feeds the
  // orb's answer card.
  const { orbTurn, orbSubmit } = useOrbTurn({
    onTurnStart: setLastSent,
    onFailure: setFailure,
    activityLabel: "Exchange in Assistant",
  });

  const handleRetry = (userText: string) =>
    void send(userText, { targetId: activeId ?? undefined, userAppended: true });

  const messages = active?.messages ?? [];
  // The ask surface shows when the active thread is empty — and stays
  // mounted through its own turn so the answer card can finish
  // revealing before the thread view takes over.
  const showOrb = orbTurn || (messages.length === 0 && !draft && !working);

  const closeSidebar = () => setSidebarOpen(false);

  return (
    <div className="ev-chat-split">
      {/* Mobile hamburger button in topbar - shown on mobile only */}
      <button
        type="button"
        className="ev-hamburger"
        aria-label={sidebarOpen ? "Close history" : "Open history"}
        aria-expanded={sidebarOpen}
        onClick={() => setSidebarOpen(!sidebarOpen)}
      >
        {sidebarOpen ? <X /> : <Menu />}
      </button>

      {/* Sidebar / History drawer */}
      <aside
        className={`ev-sidebar ev-panel ${sidebarOpen ? "ev-sidebar-open" : ""}`}
        aria-label="Conversation history"
      >
        <div className="ev-sidebar-header">
          <h2 className="ev-sidebar-title">History</h2>
          <button
            type="button"
            className="ev-btn ev-btn-primary ev-btn-sm"
            onClick={() => void newConversation()}
            aria-label="New conversation"
          >
            <MessageSquarePlus /> New
          </button>
        </div>
        <div className="ev-search" style={{ marginBottom: 8 }}>
          <Search />
          <input
            className="ev-input"
            aria-label="Search conversations"
            placeholder="Search history…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        {filtered.length === 0 ? (
          <div className="ev-empty">
            <span>{query ? "No matches." : "No conversations yet."}</span>
            <span className="ev-hint">
              {query ? "Try a different search." : "Start a new exchange above."}
            </span>
          </div>
        ) : (
          <div className="ev-conv-list">
            {filtered.map((conv) => (
              <div key={conv.id} className="ev-conv-wrapper">
                {renaming === conv.id ? (
                  <input
                    className="ev-input ev-rename-input"
                    autoFocus
                    aria-label="Rename conversation"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onBlur={() => {
                      void renameConversation(conv.id, renameValue);
                      setRenaming(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        void renameConversation(conv.id, renameValue);
                        setRenaming(null);
                      }
                      if (e.key === "Escape") setRenaming(null);
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    className="ev-conv-item"
                    aria-current={conv.id === activeId}
                    onClick={() => {
                      selectConversation(conv.id);
                      closeSidebar();
                    }}
                    onDoubleClick={() => {
                      setRenaming(conv.id);
                      setRenameValue(conv.title);
                    }}
                    title="Double-click to rename"
                  >
                    <span className="ev-conv-title">{conv.title}</span>
                    <span className="ev-conv-date">
                      {new Date(conv.updatedAt).toLocaleString("en-GB", {
                        day: "2-digit",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}{" "}
                      · {conv.messages.length} msgs
                    </span>
                  </button>
                )}
                <button
                  type="button"
                  className="ev-icon-btn ev-conv-delete"
                  aria-label={`Delete ${conv.title}`}
                  onClick={() => setDeleteId(conv.id)}
                >
                  <Trash2 />
                </button>
              </div>
            ))}
          </div>
        )}
      </aside>

      {/* Mobile backdrop */}
      {sidebarOpen && (
        <div
          className="ev-drawer-backdrop"
          onClick={closeSidebar}
          aria-hidden="true"
        />
      )}

      {/* Main thread area */}
      <main className="ev-thread-area ev-panel">
        <header className="ev-thread-topbar">
          <div className="ev-thread-topbar-left">
            <SectionLabel>E.V. // Assistant</SectionLabel>
            <h1 className="ev-h1">Conversation</h1>
          </div>
          <div className="ev-thread-topbar-right">
            <CloudPill />
            <span className="ev-hint ev-mono">core: {coreState}</span>
          </div>
        </header>
        {backendHint && backendReachable && (
          <p className="ev-thread-hint">{backendHint}</p>
        )}

        {failure && (
          <ChatFailureNotice
            failure={failure}
            onRetry={() => lastSent && void doSend(lastSent)}
            onDismiss={() => setFailure(null)}
          />
        )}

        <div className="ev-thread-content">
          {showOrb ? (
            <div className="ev-orb-wrapper">
              <MorphOrb onSubmit={orbSubmit} />
            </div>
          ) : (
            <>
              <div className="ev-thread-actions">
                <ClearThreadButton
                  disabled={messages.length === 0}
                  onClear={() => {
                    if (!activeId) return;
                    void (async () => {
                      await removeConversation(activeId);
                      const id = await newConversation();
                      if (id) selectConversation(id);
                    })();
                  }}
                />
              </div>
              <ChatThread
                conversation={active}
                draft={draft}
                working={working}
                onRetry={handleRetry}
                mode={chatMode}
                onFollowUp={(text) => void doSend(text)}
              />
            </>
          )}
        </div>

        <div className="ev-thread-composer">
          <ChatControls speak={speak} />
          <Composer onSend={(text) => void doSend(text)} onStop={() => void stop()} busy={working} />
        </div>
      </main>

      <ConfirmDialog
        open={deleteId !== null}
        title="Delete this conversation?"
        body="The conversation and its messages will be permanently removed from this device. This cannot be undone."
        confirmText="Delete"
        danger
        onConfirm={() => {
          if (deleteId) void removeConversation(deleteId);
          setDeleteId(null);
        }}
        onCancel={() => setDeleteId(null)}
      />
    </div>
  );
}

export default function AssistantPage() {
  const { ready } = useEv();
  if (!ready) return <div className="ev-stack" style={{ minHeight: "100vh" }} />;
  return <AssistantInner />;
}