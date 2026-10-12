# PROJECT E.V. — Personal AI Companion (Alfarez Console)

Next.js App Router + React + TypeScript strict + Tailwind v4 + GSAP.
Persistence is browser-local IndexedDB (`idb` wrapper) — no DB server.

## Run

```bash
pnpm install
pnpm dev      # http://localhost:3000
pnpm lint
pnpm tsc --noEmit
pnpm build
```

## Areas

| Route | Area |
|---|---|
| `/` | Main Overview — core status, quick message, diagnostics summary, activity |
| `/assistant` | Streaming chat, daily/builder mode toggle, speak-aloud, follow-up chips, history, search, rename/delete, suggested prompts |
| `/voice` | Hands-free realtime voice (one gesture, mic stays hot, server VAD, talk over E.V. to interrupt), automatic 10-min session renewal carrying the transcript forward, live level meter, opt-in "Hey E.V." wake word, E.V.-voice recording with a Save button (her realtime audio track, or her spoken replies in the local fallback — never the microphone; listed / playable / renamable / deletable on the page), honestly-labelled local dictation + chat + TTS fallback |
| `/diagnostics` | Deterministic SIMULATED demo sweep (seeded, labelled) |
| `/memory` | Notes, approved memories, conversations, activity, settings |

## Architecture

### System Overview

- **Framework & Runtime**: Next.js App Router, React 19, TypeScript strict mode.
- **Styling & Motion**: Tailwind CSS v4, GSAP for targeted animations (boot, panel entrance, scan sweep), pure CSS for ambient effects.
- **Storage**: Browser-local IndexedDB via `idb` wrapper — zero client-side database server, with optional server note store for tool actions.

### Client Layer

- `components/` — UI components, layout shell, panels, visualizer, diagnostics widgets, settings controls.
- `lib/store.tsx` — Global React state and context provider (session, connectivity status, speech synthesis, diagnostics state).
- `lib/realtime.ts` — WebRTC voice client communicating with OpenAI Realtime API via ephemeral session credentials.
- `lib/voice-recording.ts` — session recorder: captures E.V.'s voice only (realtime remote track, or concatenated TTS reply blobs in the local fallback).
- `lib/ui-actions.ts` — Dispatcher and handlers for server-emitted tool UI actions (navigation, note syncing, diagnostic scans).

### Server AI Layer

- `app/api/chat` — SSE streaming chat route (`POST`) and connectivity / setup reachability probe (`GET`).
- `app/api/voice/session` — Ephemeral client secret minting endpoint (`POST`) for OpenAI Realtime API WebRTC sessions.
- `lib/ai/*` — Server-only OpenAI client, system personality (daily + builder prompts), context pruning (sliding turn window), error handling.
- `lib/tools/*` — Tool definitions, server execution handlers, and local server note persistence.
- `lib/config/models.ts` — Centralized model configuration and environment variable overrides.

### Install + env setup + launch

```bash
pnpm install
cp .env.example .env.local   # then fill in OPENAI_API_KEY
pnpm dev                     # http://localhost:3000
```

Get a key at https://platform.openai.com/api-keys. The key is read
server-side only (`process.env.OPENAI_API_KEY`) — never `NEXT_PUBLIC_`,
never shipped to the browser, never written to IndexedDB. All model IDs are
centralized in `lib/config/models.ts` and overridable via env
(`OPENAI_TEXT_MODEL`, `OPENAI_REALTIME_MODEL`, `OPENAI_REALTIME_VOICE`,
defaults `gpt-5.6-terra` / `gpt-realtime-2.1` / `marin`, verified against
official docs on 2026-10-12). To change a model: edit `.env.local` and
restart `pnpm dev` — no code change needed.

### API setup

- **Text** — `POST /api/chat` with `{ messages: [{ role, content }] }`
  (optional `conversationId`, `mode: "daily" | "builder"`, plus optional `notes` /
  `memories` / `memorySummary` the frontend shares per request). Replies stream SSE:
  `data: {"token":"..."}` lines, tool UI actions as `data: {"ui":{...}}`,
  terminator `data: [DONE]`. Context window: last 20 user/assistant turns +
  shared system context only — full history never crosses the wire.
  `GET /api/chat` returns a non-404 status payload (reachability probe +
  setup state).
- **Personality** — `lib/ai/personality.ts` builds the instructions per mode.
  `daily` (default when `mode` is absent) is the resting register: E.V. answers
  as a person, with no tool offers, no self-description as an assistant, no
  unsolicited technical suggestions, and short spoken-style replies that hold the
  thread. `builder` welcomes system and tool detail — exact commands, versions,
  trade-offs. Tone calibration lives in the prompt's few-shot exchanges, so the
  mode only changes the next request's instructions; it never touches history.
  The same prompt fronts `/api/chat`; `/api/voice/session` uses the compact
  spoken-style variant in `EV_VOICE_INSTRUCTIONS`.
- **Chat client prefs** — chat mode, speak-aloud and the chosen
  `speechSynthesis` voice live in `AppSettings` (IndexedDB, same store as every
  other preference). Speak-aloud is browser speech synthesis in the text chat:
  off by default, cancels on send/typing/unmount, and surfaces an honest notice
  when the platform has no voice or blocks playback.
- **Voice** — `POST /api/voice/session` mints an ephemeral Realtime client
  secret (`POST /v1/realtime/client_secrets`, TTL 10 min) and returns
  `{ clientSecret, expiresAt, realtimeUrl, webrtc, session }`. The permanent
  key stays server-side. The session is configured server-side with semantic
  VAD turn detection (`create_response` + `interrupt_response`): the server
  ends turns and answers hands-free. Browser flow: POST SDP offer to
  `realtimeUrl` (`https://api.openai.com/v1/realtime/calls`) with
  `Authorization: Bearer <clientSecret>` over WebRTC; transcripts and events
  arrive on the `oai-events` data channel. Talking over E.V. barge-ins: the
  client sends `response.cancel` + `output_audio_buffer.clear` (which also
  truncates the conversation server-side) and silences the remote audio. The
  10-minute secret renews automatically at a quiet point — the recent
  transcript is replayed into the replacement session as conversation items,
  no duplicate entries. Fallback TTS: `POST /api/voice/tts` (free Edge
  Read Aloud primary, keyed providers optional, picked via the
  `X-TTS-Provider` header). Session recording (E.V.'s
  voice only, never the microphone): on the realtime
  link her remote audio track is recorded with
  MediaRecorder (WebM/Opus when supported); in the
  local fallback each spoken reply's TTS blob is
  concatenated. Save recording persists the segment so
  far to IndexedDB and starts a fresh segment; the
  unsaved tail is discarded on hangup. Cleanup on
  hangup: stop the recorder + close its AudioContext, stop all mic
  tracks, close the data channel + peer connection, clear
  `srcObject`.

### Tools (real vs simulated)

Function tools the model can call (schemas in `lib/tools/definitions.ts`,
runtime in `lib/tools/handlers.ts`, executed server-side inside the
`/api/chat` Responses API loop):

| Tool | Kind | What happens |
|---|---|---|
| `save_note` | REAL | Persists to the server JSON store (`data/`, gitignored) AND emits a `note-saved` UI action the frontend mirrors into IndexedDB (`persisted: "both"`). |
| `search_notes` | REAL | Searches request-shared notes + the server store, de-duplicated. |
| `get_memories` | REAL | Reads back only approved memories the frontend shared with the request. |
| `open_panel` | REAL UI action | Returns `{ kind: "open-panel", panel, reason }` the frontend navigates to (overview/assistant/voice/diagnostics/memory/notes). |
| `start_diagnostic_scan` | SIMULATED | Returns a `diagnostic-scan` UI action; the scan measures no real hardware (frontend labels it simulated). |
| `get_app_status` | REAL | Reports live observed backend status (models, key configured, time). |
| `summarize_user_text` | REAL | Deterministic local extractive summary of pasted text. |

Tool results return to the assistant as `function_call_output` for
explanation. The assistant must relay the real/simulated marking and never
claim an unexecuted external action succeeded.

### Troubleshooting

| Symptom | Meaning | Fix |
|---|---|---|
| `GET /api/chat` → `status: "setup-required"` / POST → 503 `setup_required` | No key | Copy `.env.example` → `.env.local`, set `OPENAI_API_KEY`, restart dev. |
| 500 `invalid_credentials` | Key rejected | Check the key for quotes/spaces, verify at platform.openai.com, restart. |
| 502 `model_unavailable` | Model ID retired or not enabled | Verify IDs at platform.openai.com/docs/models, update `OPENAI_*_MODEL`, restart. |
| 429 `quota_exceeded` | Billing empty | Top up at platform.openai.com/account/billing. Local features keep working. |
| 429 `rate_limited` | Too many requests | Wait, retry with backoff. |
| In-stream `[E.V. connection issue …]` | Mid-response failure | Retry; shorter messages help on this box. |
| Partial text + `[Response stopped]` | You hit stop | Frontend abort — partial text preserved, nothing lost. |
| Mic denied | Browser blocked mic | Allow mic in the browser site settings, use HTTPS/localhost, retry from a user gesture. |
| Realtime silent / lost | Token expired (10 min) or network | Renewal is automatic — let it re-mint; if it stays dead, end and start a fresh voice session. |

### Verify

```bash
pnpm lint
pnpm exec tsc --noEmit
pnpm build
```


## Notes

- Dark workstation UI is diegetic (suit-ops console), documented in `globals.css`.
- Red accent rationed to core speaking/error glow + destructive confirms.
- GSAP only: boot, panel entrances, scan bar. Ambient motion is CSS.
  `prefers-reduced-motion` respected + a manual override in Memory settings.
- Diagnostics values are seeded (`mulberry32`) — stable across renders.
- No secrets are stored client-side; storage failures surface with next steps.
