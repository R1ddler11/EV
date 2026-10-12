/* PROJECT E.V. — tool schemas exposed to the model (backend-owned).
   Single source of truth for function tools: JSON Schema for the Responses API
   plus the UI-action contract the frontend executes. Real vs simulated is marked
   on every tool and repeated in handler results — the model must relay it. */

export const TOOL_NAMES = [
  "save_note",
  "search_notes",
  "get_memories",
  "open_panel",
  "start_diagnostic_scan",
  "get_app_status",
  "summarize_user_text",
  "control_spotify",
  "open_youtube",
  "search_web",
  "open_application",
  "run_desktop_command",
] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

/** Panels the frontend can actually navigate to. */
export const PANELS = [
  "overview",
  "assistant",
  "voice",
  "diagnostics",
  "memory",
  "notes",
] as const;
export type PanelId = (typeof PANELS)[number];

export interface ToolDefinition {
  type: "function";
  name: ToolName;
  description: string;
  parameters: Record<string, unknown>;
  strict: boolean;
}

/**
 * Function tools for `client.responses.create({ tools })`.
 * Descriptions carry the real-vs-simulated marking so the model states it.
 */
export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    type: "function",
    name: "save_note",
    description:
      "REAL: persist a note for Alfarez. Call when asked to remember, jot down, or save something as a note. Returns the saved note the frontend stores.",
    parameters: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Short note title (max 120 chars).",
        },
        body: {
          type: "string",
          description: "Note body in plain text or markdown (max 8000 chars).",
        },
      },
      required: ["title", "body"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "search_notes",
    description:
      "REAL: search notes Alfarez shared with this request by keyword. Only searches notes present in the request context — say so if none were shared.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Keyword(s) to match against titles and bodies.",
        },
        limit: {
          type: "number",
          description: "Max results (default 5, max 20).",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "get_memories",
    description:
      "REAL: read back user-approved memories shared with this request. Use when Alfarez asks what you remember or when background context is needed.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Optional keyword filter. Omit to list all shared memories.",
        },
      },
      required: [],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "open_panel",
    description:
      "REAL UI ACTION: navigate the app to one of its real panels. Returns an action payload the frontend executes. Only use for panels in the enum.",
    parameters: {
      type: "object",
      properties: {
        panel: {
          type: "string",
          enum: [...PANELS],
          description: "Destination panel.",
        },
        reason: {
          type: "string",
          description: "One line for the user on why this panel helps.",
        },
      },
      required: ["panel", "reason"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "start_diagnostic_scan",
    description:
      "SIMULATED: trigger the app's deterministic simulated diagnostic scan. It measures no real hardware — always tell the user it is a simulation when reporting results.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "get_app_status",
    description:
      "REAL: report live backend status you actually observed — model IDs, key configured, time, tool round. Never invent device or hardware readings.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "summarize_user_text",
    description:
      "REAL: produce an extractive summary of user-provided text passed as an argument (local, deterministic — no extra model call). Use for long pasted text the user wants condensed.",
    parameters: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "The text to summarize (max 20000 chars).",
        },
        max_points: {
          type: "number",
          description: "Max bullet points (default 5, max 10).",
        },
      },
      required: ["text"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "control_spotify",
    description:
      "Control Spotify music playback or search and play music on the local computer. Actions: play, pause, play_pause, next, previous, search_and_play, status.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: [
            "play",
            "pause",
            "play_pause",
            "next",
            "previous",
            "search_and_play",
            "status",
          ],
          description: "Playback action to perform.",
        },
        query: {
          type: "string",
          description: "Optional track, artist, album, or search query.",
        },
      },
      required: ["action"],
      additionalProperties: false,
    },
    strict: false,
  },
  {
    type: "function",
    name: "open_youtube",
    description:
      "Search and open YouTube videos or music on the user's desktop browser. Can search for a topic/song or open a specific video.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search terms or video title.",
        },
        autoplay: {
          type: "boolean",
          description: "Optional autoplay flag.",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
    strict: false,
  },
  {
    type: "function",
    name: "search_web",
    description:
      "Perform a web search and open the search results in the user's default browser on their desktop.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search keywords.",
        },
        engine: {
          type: "string",
          enum: ["duckduckgo", "google", "youtube"],
          description: "Search engine to use (default: duckduckgo).",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
    strict: false,
  },
  {
    type: "function",
    name: "open_application",
    description:
      "Launch or focus an application on the user's desktop (e.g. spotify, browser, terminal, code, files, discord, or custom command).",
    parameters: {
      type: "object",
      properties: {
        app: {
          type: "string",
          description:
            "App name or executable, e.g. 'spotify', 'browser', 'code', 'terminal', 'files'.",
        },
      },
      required: ["app"],
      additionalProperties: false,
    },
    strict: false,
  },
  {
    type: "function",
    name: "run_desktop_command",
    description:
      "Execute a desktop command or media/system utility on the user's Arch Linux / Hyprland machine (e.g. volume control with wpctl/pamixer, notify-send, etc.).",
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "Command to execute.",
        },
      },
      required: ["command"],
      additionalProperties: false,
    },
    strict: false,
  },
];
