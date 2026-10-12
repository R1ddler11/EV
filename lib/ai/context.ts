/* PROJECT E.V. — intentional context window (backend-owned).
   The full conversation history is NEVER sent to the model. Only the trailing
   window plus an optional memory summary cross the wire. */

import { CHAT_CONTEXT_WINDOW } from "../config/models";

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface WindowedContext {
  window: ChatMessage[];
  /** How many leading messages were dropped. */
  omitted: number;
}

/** Keep the trailing window; drop (never summarize) raw old turns server-side. */
export function truncateToWindow(
  messages: ChatMessage[],
  size: number = CHAT_CONTEXT_WINDOW,
): WindowedContext {
  if (messages.length <= size) return { window: messages, omitted: 0 };
  return {
    window: messages.slice(messages.length - size),
    omitted: messages.length - size,
  };
}

/**
 * Short system notice prepended when history was cut, so the model knows the
 * head of the conversation is missing instead of hallucinating it.
 */
export function truncationNotice(omitted: number): string | null {
  if (omitted <= 0) return null;
  return (
    `[System note: ${omitted} earlier message(s) were omitted to keep the ` +
    `context window small. Do not invent their contents; ask if you need them.]`
  );
}
