/* PROJECT E.V. — shared orb turn (frontend-owned).
   The ask-surface turn, shared by the home hero and the
   assistant's empty state: create a conversation if none
   is active, persist the user turn, stream E.V.'s reply
   with the persisted chat mode and conversation context
   threaded through, persist the reply, and hand the reply
   text back to the orb's answer card. Failures return the
   backend's own cause and next step — never a placeholder. */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BackendUnavailableError,
  postChatStream,
  type ChatPayloadMessage,
} from "@/lib/api";
import { newId } from "@/lib/types";
import { handleUiAction } from "@/lib/ui-actions";
import { useEv } from "@/lib/store";

export interface OrbTurnHandlers {
  /** Page bookkeeping — the last text sent (failure retry). */
  onTurnStart?: (text: string) => void;
  /** Page failure surface (its ChatFailureNotice). */
  onFailure?: (failure: { message: string; hint: string }) => void;
  /** Activity-ledger label for the completed exchange. */
  activityLabel?: string;
}

export function useOrbTurn(handlers: OrbTurnHandlers = {}) {
  const router = useRouter();
  const {
    activeId,
    chatMode,
    conversations,
    memories,
    mirrorNote,
    newConversation,
    notes,
    appendMessage,
    recordActivity,
    requestScan,
    setCoreState,
    settings,
  } = useEv();
  const [orbTurn, setOrbTurn] = useState(false);
  const orbTimerRef = useRef<number | undefined>(undefined);
  // Latest-ref: pages pass fresh handler identities each
  // render; the turn reads them without re-creating itself.
  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  });

  // Clear the reveal timer on unmount.
  useEffect(
    () => () => window.clearTimeout(orbTimerRef.current),
    [],
  );

  const orbSubmit = useCallback(
    async (prompt: string): Promise<string> => {
      const text = prompt.trim();
      if (!text) return "Ask E.V. anything — type a question and press enter.";
      handlersRef.current.onTurnStart?.(text);
      window.clearTimeout(orbTimerRef.current);
      setOrbTurn(true);

      let convId = activeId;
      if (!convId) {
        convId = await newConversation();
        if (!convId) {
          setOrbTurn(false);
          const failure = {
            message: "Could not create a conversation.",
            hint: "Local storage refused the write — see the banner above, free space, then retry.",
          };
          handlersRef.current.onFailure?.(failure);
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
        await recordActivity(
          "chat",
          handlersRef.current.activityLabel ?? "Exchange in Assistant",
        );
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
        handlersRef.current.onFailure?.({ message, hint });
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
      settings,
    ],
  );

  return { orbTurn, orbSubmit };
}
