/* PROJECT E.V. — tool UI-action executor (frontend-owned).
   The backend streams `data: {"ui": …}` lines when the model calls tools
   (see lib/tools/handlers.ts UiAction, backend-owned). This module executes
   them against local state — IndexedDB mirrors, navigation, scan triggers,
   activity entries. Called from useChat.send via StreamOptions.onUi. */

import type { UiAction } from "@/lib/api";
import type { Note } from "./types";

const PANEL_ROUTES: Record<string, string> = {
  overview: "/",
  assistant: "/assistant",
  voice: "/voice",
  diagnostics: "/diagnostics",
  memory: "/memory",
  notes: "/memory",
};

export interface UiActionDeps {
  mirrorNote: (note: Note) => Promise<void>;
  recordActivity: (
    kind: "chat" | "voice" | "note" | "memory" | "diagnostic" | "system",
    label: string,
    detail?: string,
  ) => Promise<void>;
  requestScan: () => void;
  navigate: (href: string) => void;
}

/** Execute one backend UI action. Never throws — failures become activity. */
export async function handleUiAction(
  action: UiAction,
  deps: UiActionDeps,
): Promise<void> {
  try {
    switch (action.kind) {
      case "note-saved": {
        if (action.note) {
          const now = Date.now();
          await deps.mirrorNote({
            id: action.note.id,
            title: action.note.title,
            body: action.note.body,
            createdAt: action.note.createdAt || now,
            updatedAt: now,
          });
        } else {
          await deps.recordActivity(
            "system",
            "Note tool ran without content",
            action.reason,
          );
        }
        break;
      }
      case "open-panel": {
        const route = (action.panel && PANEL_ROUTES[action.panel]) || null;
        if (route) {
          deps.navigate(route);
          await deps.recordActivity(
            "system",
            `Opened ${action.panel} panel`,
            action.reason,
          );
        }
        break;
      }
      case "diagnostic-scan": {
        deps.navigate("/diagnostics");
        deps.requestScan();
        await deps.recordActivity(
          "diagnostic",
          "Scan requested by assistant",
          action.reason,
        );
        break;
      }
      case "app-status": {
        await deps.recordActivity(
          "system",
          "Status report delivered",
          action.reason,
        );
        break;
      }
      case "desktop-action": {
        await deps.recordActivity(
          "system",
          action.detail || action.action || "Desktop action executed",
          action.reason,
        );
        break;
      }
    }
  } catch (error) {
    await deps.recordActivity(
      "system",
      `UI action failed (${action.kind})`,
      error instanceof Error ? error.message : "unknown error",
    );
  }
}
