import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);
/* PROJECT E.V. — tool runtime: execute model calls, format results (backend-owned).
   Each handler returns prose for the model plus an optional `ui` payload the
   chat route forwards as an SSE event for the frontend to execute.
   Request-scoped data (notes/memories the frontend shares per request) flows
   through ToolContext — the server keeps no cross-request user profile. */

import {
  CHAT_CONTEXT_WINDOW,
  getRealtimeModel,
  getRealtimeVoice,
  getTextModel,
} from "../config/models";
import { PANELS, type PanelId, type ToolName } from "./definitions";
import { saveServerNote, searchServerNotes, type SharedNote } from "./store";

export interface SharedMemory {
  text: string;
  enabled?: boolean;
}

export interface ToolContext {
  /** Notes the frontend included with this request (IndexedDB mirror). */
  notes: SharedNote[];
  /** Approved memories the frontend included with this request. */
  memories: SharedMemory[];
}

export interface UiAction {
  kind:
    | "note-saved"
    | "open-panel"
    | "diagnostic-scan"
    | "app-status"
    | "desktop-action";
  note?: { id: string; title: string; body: string; createdAt: number };
  panel?: PanelId;
  reason?: string;
  persisted?: "server" | "client-mirror" | "both";
  simulated?: boolean;
  action?: string;
  detail?: string;
}

export interface ToolOutcome {
  /** Text appended as function_call_output for the model to explain. */
  result: string;
  /** Forwarded to the browser as `data: {"ui":...}` — frontend executes it. */
  ui?: UiAction;
}

function parseArgs(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw || "{}");
    if (typeof parsed === "object" && parsed !== null) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* fall through to {} */
  }
  return {};
}

function str(value: unknown, max: number): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

function num(value: unknown, fallback: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(max, Math.floor(value)));
}

function sentenceCase(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return clean;
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

/** First-sentence extractive summary — deterministic, runs locally. */
function extractiveSummary(text: string, maxPoints: number): string[] {
  const sentences = text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return sentences.slice(0, maxPoints).map(sentenceCase);
}

export async function executeTool(
  name: string,
  rawArgs: string,
  ctx: ToolContext,
): Promise<ToolOutcome> {
  const args = parseArgs(rawArgs);

  switch (name as ToolName) {
    case "save_note": {
      const title = str(args.title, 120).trim();
      const body = str(args.body, 8000).trim();
      if (!title || !body) {
        return {
          result: "save_note failed: both a non-empty title and body are required. Ask Alfarez for the missing piece.",
        };
      }
      const saved = await saveServerNote(title, body);
      return {
        result:
          `REAL — note saved to the server store (id ${saved.id}). ` +
          "Tell Alfarez it is saved and briefly confirm the title.",
        ui: {
          kind: "note-saved",
          note: {
            id: saved.id,
            title: saved.title,
            body: saved.body,
            createdAt: saved.createdAt,
          },
          persisted: "both",
        },
      };
    }

    case "search_notes": {
      const query = str(args.query, 500).trim();
      const limit = num(args.limit, 5, 20);
      if (!query) {
        return { result: "search_notes needs a keyword query. Ask what to search for." };
      }
      const terms = query.toLowerCase().split(/\s+/);
      const shared = ctx.notes.filter((n) => {
        const hay = `${n.title}\n${n.body}`.toLowerCase();
        return terms.every((t) => hay.includes(t));
      });
      const server = await searchServerNotes(query, limit);
      const seen = new Set(shared.map((n) => n.id ?? `${n.title}\n${n.body}`));
      const merged = [
        ...shared.slice(0, limit).map((n) => ({ title: n.title, body: n.body })),
        ...server
          .filter((n) => !seen.has(n.id))
          .map((n) => ({ title: n.title, body: n.body })),
      ].slice(0, limit);
      if (merged.length === 0) {
        return {
          result: `REAL — searched shared + saved notes for "${query}": no matches. Say so plainly and offer to save a new note.`,
        };
      }
      const lines = merged
        .map((n, i) => `${i + 1}. ${n.title} — ${n.body.slice(0, 160)}`)
        .join("\n");
      return {
        result: `REAL — ${merged.length} note match(es) for "${query}" (shared + saved):\n${lines}\nSummarize these for Alfarez; quote briefly, do not dump full bodies unless asked.`,
      };
    }

    case "get_memories": {
      const query = str(args.query, 500).trim().toLowerCase();
      const enabled = ctx.memories.filter((m) => m.enabled !== false);
      const matches = query
        ? enabled.filter((m) => m.text.toLowerCase().includes(query))
        : enabled;
      if (matches.length === 0) {
        return {
          result:
            "REAL — no approved memories were shared with this request" +
            (query ? ` matching "${query}"` : "") +
            ". Say honestly you have nothing stored on that, and offer to note it down if Alfarez wants you to remember.",
        };
      }
      const lines = matches
        .slice(0, 12)
        .map((m, i) => `${i + 1}. ${m.text}`)
        .join("\n");
      return {
        result: `REAL — approved memories shared with this request:\n${lines}\nUse as background; do not read back verbatim unless asked.`,
      };
    }

    case "open_panel": {
      const panel = str(args.panel, 40);
      const reason = str(args.reason, 300).trim();
      if (!(PANELS as readonly string[]).includes(panel)) {
        return {
          result: `open_panel failed: "${panel}" is not a real panel. Valid panels: ${(PANELS as readonly string[]).join(", ")}.`,
        };
      }
      return {
        result:
          `REAL UI ACTION — navigate to the ${panel} panel. ` +
          "Confirm briefly that you are opening it.",
        ui: {
          kind: "open-panel",
          panel: panel as PanelId,
          reason: reason || `Opening ${panel}.`,
        },
      };
    }

    case "start_diagnostic_scan": {
      return {
        result:
          "SIMULATED — diagnostic scan triggered. The frontend runs its deterministic simulated scan (no real hardware is measured). Narrate progress briefly and, when results arrive, label them clearly as simulated.",
        ui: { kind: "diagnostic-scan", simulated: true },
      };
    }

    case "get_app_status": {
      const status =
        `REAL backend status (observed server-side just now): text model ${getTextModel()}, ` +
        `realtime model ${getRealtimeModel()} (voice ${getRealtimeVoice()}), ` +
        `context window last ${CHAT_CONTEXT_WINDOW} messages, OpenAI key configured, ` +
        `server time ${new Date().toISOString()}. ` +
        "Report exactly this; do not invent device, hardware, or network readings.";
      return {
        result: status,
        ui: { kind: "app-status" },
      };
    }

    case "summarize_user_text": {
      const text = str(args.text, 20000).trim();
      const maxPoints = num(args.max_points, 5, 10);
      if (!text) {
        return { result: "summarize_user_text needs text to summarize. Ask Alfarez to paste it." };
      }
      const points = extractiveSummary(text, maxPoints);
      return {
        result:
          `REAL extractive summary (local, first-sentence extraction — say it is condensed, not a full paraphrase):\n` +
          points.map((p, i) => `${i + 1}. ${p}`).join("\n"),
      };
    }
    case "control_spotify": {
      const action = str(args.action, 50).trim() || "play_pause";
      const query = str(args.query, 500).trim();

      try {
        if (query || action === "search_and_play") {
          const searchQuery = query || "";
          const uri = `spotify:search:${encodeURIComponent(searchQuery)}`;
          try {
            await execAsync(`xdg-open "${uri}" || (spotify &)`);
          } catch {
            await execAsync(`spotify &`);
          }
          if (action === "play" || action === "search_and_play") {
            setTimeout(() => {
              execAsync(`playerctl -p spotify play`).catch(() => {});
            }, 1000);
          }
          return {
            result: `REAL: Opened Spotify search for "${searchQuery}" and initiated playback.`,
            ui: {
              kind: "desktop-action",
              action: "spotify",
              detail: `Spotify: ${action} ${query}`.trim(),
            },
          };
        }

        let cmd = "playerctl -p spotify play-pause";
        if (action === "play") cmd = "playerctl -p spotify play";
        else if (action === "pause") cmd = "playerctl -p spotify pause";
        else if (action === "play_pause") cmd = "playerctl -p spotify play-pause";
        else if (action === "next") cmd = "playerctl -p spotify next";
        else if (action === "previous") cmd = "playerctl -p spotify previous";
        else if (action === "status") cmd = "playerctl -p spotify metadata";

        try {
          const { stdout } = await execAsync(cmd, { timeout: 4000 });
          const out = stdout ? ` Output: ${stdout.trim()}` : "";
          return {
            result: `REAL: Executed Spotify command "${action}".${out}`,
            ui: {
              kind: "desktop-action",
              action: "spotify",
              detail: `Spotify: ${action}`,
            },
          };
        } catch {
          // playerctl failed (e.g. Spotify not running)
          await execAsync(`xdg-open "spotify:" || (spotify &)`);
          return {
            result: `REAL: Spotify was not responding to playerctl, so launched Spotify application.`,
            ui: {
              kind: "desktop-action",
              action: "spotify",
              detail: `Spotify: launched application`,
            },
          };
        }
      } catch (err) {
        return {
          result: `Failed to control Spotify: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }

    case "open_youtube": {
      const query = str(args.query, 500).trim();
      if (!query) {
        return { result: "open_youtube requires a search query or video title." };
      }
      const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
      try {
        exec(`xdg-open "${url}"`);
        return {
          result: `REAL: Opened YouTube search for "${query}" in the desktop browser.`,
          ui: {
            kind: "desktop-action",
            action: "youtube",
            detail: query,
          },
        };
      } catch (err) {
        return {
          result: `Failed to open YouTube: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }

    case "search_web": {
      const query = str(args.query, 500).trim();
      const engine = str(args.engine, 30).toLowerCase() || "duckduckgo";
      if (!query) {
        return { result: "search_web requires a search query." };
      }

      let url = `https://duckduckgo.com/?q=${encodeURIComponent(query)}`;
      if (engine === "google") {
        url = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
      } else if (engine === "youtube") {
        url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
      }

      try {
        exec(`xdg-open "${url}"`);
        return {
          result: `REAL: Performed web search using ${engine} for "${query}".`,
          ui: {
            kind: "desktop-action",
            action: "search",
            detail: query,
          },
        };
      } catch (err) {
        return {
          result: `Failed to search web: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }

    case "open_application": {
      const app = str(args.app, 200).trim().toLowerCase();
      if (!app) {
        return { result: "open_application requires an application name." };
      }

      let cmd = app;
      if (app === "spotify") {
        cmd = "spotify || xdg-open spotify:";
      } else if (app === "browser") {
        cmd = "xdg-open https://google.com";
      } else if (app === "terminal") {
        cmd = "hyprctl dispatch exec alacritty || hyprctl dispatch exec kitty || x-terminal-emulator";
      } else if (app === "code") {
        cmd = "code || codium";
      } else if (app === "files") {
        cmd = "xdg-open ~ || thunar ~ || nautilus ~";
      }

      try {
        exec(cmd);
        return {
          result: `REAL: Launched application "${app}".`,
          ui: {
            kind: "desktop-action",
            action: "app",
            detail: `Launched ${app}`,
          },
        };
      } catch (err) {
        return {
          result: `Failed to launch application "${app}": ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }

    case "run_desktop_command": {
      const command = str(args.command, 2000).trim();
      if (!command) {
        return { result: "run_desktop_command requires a command to execute." };
      }

      try {
        const { stdout, stderr } = await execAsync(command, { timeout: 5000 });
        const outParts: string[] = [];
        if (stdout?.trim()) outParts.push(`stdout:\n${stdout.trim()}`);
        if (stderr?.trim()) outParts.push(`stderr:\n${stderr.trim()}`);
        const outStr = outParts.length > 0 ? `\n${outParts.join("\n")}` : " (no output)";
        return {
          result: `REAL: Executed command "${command}".${outStr}`,
          ui: {
            kind: "desktop-action",
            action: "command",
            detail: command,
          },
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          result: `Error executing command "${command}": ${msg}`,
        };
      }
    }


    default:
      return {
        result: `Unknown tool "${name}" — no action was executed. Tell Alfarez you could not do that and offer an alternative. Never claim success.`,
      };
  }
}
