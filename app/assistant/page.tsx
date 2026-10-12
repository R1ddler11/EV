/* PROJECT E.V. — Assistant area (frontend-owned).
   Streaming thread, history list with search/filter, new conversation,
   rename, delete, copy/retry/stop, clear-thread confirm, suggested prompts,
   chat-mode toggle (daily/builder), speak-aloud controls and locally derived
   follow-up chips. Integrated with the dashboard: shares the store, core
   state and activity. */
"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { MessageSquarePlus, Search, Trash2 } from "lucide-react";
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
import { useEv } from "@/lib/store";
import MorphOrb from "@/components/ui/ai-thiking-orb-and-input";
import {
  BackendUnavailableError,
  postChatStream,
  type ChatPayloadMessage,
} from "@/lib/api";
import { newId } from "@/lib/types";
import { handleUiAction } from "@/lib/ui-actions";

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
    recordActivity,
    appendMessage,
    setCoreState,
    mirrorNote,
    requestScan,
    settings,
    memories,
    notes,
  } = useEv();
  const { draft, working, failure, setFailure, send, stop, speak, chatMode } = useChat();
  const [query, setQuery] = useState("");
  const [lastSent, setLastSent] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);
  // The MorphOrb owns the empty state. It stays mounted through its
  // own turn (orbTurn) so the answer card can show E.V.'s real reply;
  // the thread view takes over once the card has finished revealing.
  const [orbTurn, setOrbTurn] = useState(false);
  const orbTimerRef = useRef<number | undefined>(undefined);

  useEffect(
    () => () => window.clearTimeout(orbTimerRef.current),
    [],
  );

  useEffect(() => {
    if (params.get("new") === "1" && ready) {
      void newConversation();
      router.replace("/assistant");
    }
  }, [params, ready, newConversation, router]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        c.messages.some((m) => m.content.toLowerCase().includes(q)),
    );
  }, [conversations, query]);

  const doSend = async (text: string) => {
    const ok = await send(text);
    if (ok) {
      setLastSent(text);
      await recordActivity("chat", "Exchange in Assistant");
    } else {
      setLastSent(text);
    }
  };

  // The ask-surface turn. Mirrors useChat.send: create a conversation
  // if none is active, persist the user turn, stream E.V.'s reply with
  // the persisted chat mode and conversation context threaded through,
  // persist the reply, then hand the surface to the thread view. The
  // returned text feeds the orb's answer card; failures return the
  // backend's own cause and next step so the card is never a
  // placeholder.
  const orbSubmit = useCallback(
    async (prompt: string): Promise<string> => {
      const text = prompt.trim();
      if (!text) return "Ask E.V. anything — type a question and press enter.";
      setLastSent(text);
      window.clearTimeout(orbTimerRef.current);
      setOrbTurn(true);

      let convId = activeId;
      if (!convId) {
        convId = await newConversation();
        if (!convId) {
          setOrbTurn(false);
          setFailure({
            message: "Could not create a conversation.",
            hint: "Local storage refused the write — see the banner above, free space, then retry.",
          });
          return "Could not open a conversation — local storage refused the write. Free space or allow IndexedDB, then ask again.";
        }
      }
      await appendMessage(convId, {
        id: newId("msg"),
        role: "user",
        content: text,
        createdAt: Date.now(),
      });
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
        history.push({ role: "user", content: text });

        const result = await postChatStream(history, {
          apiKey: settings.openRouterApiKey || undefined,
          model: settings.openRouterModel || undefined,
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

        const body = (result.text || "").trim();
        const reply = body || "(The backend answered with empty text.)";
        await appendMessage(convId, {
          id: newId("msg"),
          role: "assistant",
          content: reply,
          createdAt: Date.now(),
        });
        await recordActivity("chat", "Exchange in Assistant");
        setCoreState("idle");

        // Keep the ask surface up for the orb's own reveal window
        // (resolve 900ms + condense 800ms + the unfold word-stagger),
        // then hand over to the thread view.
        const words = body.split(/\s+/).filter(Boolean).length;
        const stagger = words > 1 ? Math.min(45, 280 / (words - 1)) : 0;
        orbTimerRef.current = window.setTimeout(
          () => setOrbTurn(false),
          2300 + (words - 1) * stagger + 320,
        );
        return reply;
      } catch (error) {
        setCoreState("disconnected");
        const message =
          error instanceof BackendUnavailableError
            ? error.message
            : error instanceof Error
              ? error.message
              : "Assistant failed";
        const hint =
          error instanceof BackendUnavailableError
            ? error.hint
            : "Check the API connection or try again in a moment.";
        setFailure({ message, hint });
        orbTimerRef.current = window.setTimeout(() => setOrbTurn(false), 2600);
        return `${message} Next step: ${hint}`;
      }
    },
    [
      activeId,
      appendMessage,
      chatMode,
      conversations,
      memories,
      mirrorNote,
      newConversation,
      notes,
      recordActivity,
      requestScan,
      router,
      setCoreState,
      setFailure,
      settings.memoryEnabled,
      settings.openRouterApiKey,
      settings.openRouterModel,
    ],
  );

  const handleRetry = (userText: string) =>
    void send(userText, { targetId: activeId ?? undefined, userAppended: true });


  const messages = active?.messages ?? [];
  // The ask surface shows when the active thread is empty — and stays
  // mounted through its own turn so the answer card can finish
  // revealing before the thread view takes over.
  const showOrb = orbTurn || (messages.length === 0 && !draft && !working);

  return (
    <div className="ev-stack">
      <header className="ev-page-head">
        <SectionLabel>E.V. // Assistant</SectionLabel>
        <h1 className="ev-h1">Conversation</h1>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <CloudPill />
          <span className="ev-hint ev-mono">core: {coreState}</span>
        </div>
        {backendHint && backendReachable && (
          <p className="ev-hint">{backendHint}</p>
        )}
      </header>

      {failure && (
        <ChatFailureNotice
          failure={failure}
          onRetry={() => lastSent && void doSend(lastSent)}
          onDismiss={() => setFailure(null)}
        />
      )}

      <div className="ev-chat-layout">
        <aside className="ev-panel ev-panel-tight" aria-label="Conversation history">
          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            <button
              type="button"
              className="ev-btn ev-btn-primary ev-btn-sm"
              style={{ flex: 1 }}
              onClick={() => void newConversation()}
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
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {filtered.map((conv) => (
                <div key={conv.id} style={{ position: "relative" }}>
                  {renaming === conv.id ? (
                    <input
                      className="ev-input"
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
                      onClick={() => selectConversation(conv.id)}
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
                    className="ev-icon-btn"
                    aria-label={`Delete ${conv.title}`}
                    style={{ position: "absolute", right: 4, top: 6 }}
                    onClick={() => setDeleteId(conv.id)}
                  >
                    <Trash2 />
                  </button>
                </div>
              ))}
            </div>
          )}
        </aside>

        <section className="ev-panel" aria-label="Active thread">
          {showOrb ? (
            <MorphOrb onSubmit={orbSubmit} />
          ) : (
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 6 }}>
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
          )}

          <ChatThread
            conversation={active}
            draft={draft}
            working={working}
            onRetry={handleRetry}
            mode={chatMode}
            onFollowUp={(text) => void doSend(text)}
          />

          <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
            <ChatControls speak={speak} />
            <Composer onSend={(text) => void doSend(text)} onStop={() => void stop()} busy={working} />
          </div>
        </section>
      </div>

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
  return (
    <Suspense fallback={<div className="ev-empty">Loading assistant…</div>}>
      <AssistantInner />
    </Suspense>
  );
}
