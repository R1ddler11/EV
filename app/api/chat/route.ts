/* PROJECT E.V. — text path: POST /api/chat (backend-owned).
   ---------------------------------------------------------------------------
   Contract (frontend lib/api.ts):
   - POST accepts { messages: [{ role, content }], conversationId?, mode? } and
     returns a text/event-stream SSE feed: `data: {"token":"..."}` lines ending
     with `data: [DONE]`. Tool UI actions ride the same feed as
     `data: {"ui":{...}}` (ignored as text, executed by the frontend).
   - `mode` is "daily" (default, omitted is fine) or "builder"; it only picks
     the system instructions — the SSE contract is identical either way.
   - GET returns a non-404 status payload so the UI can show a setup state.
   - OPTIONS answers the reachability probe.
   - Missing key -> 503 JSON { error, code, hint }. Never leaks secrets,
     stack traces, or raw provider payloads.
   Model: chat completions streaming (OpenAI SDK pointed at OpenRouter),
   server-side tool loop (MAX_TOOL_ROUNDS), intentional context window
   (last 20 turns + memory summary only). Docs checked 2026-10-12.
   --------------------------------------------------------------------------- */

import type { ChatCompletionChunk, ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat/completions";
import type { Stream } from "openai/streaming";
import { z } from "zod";
import { truncateToWindow, truncationNotice } from "@/lib/ai/context";
import { mapOpenAIError, type SafeApiError } from "@/lib/ai/errors";
import { getOpenRouterClient } from "@/lib/ai/openai-client";
import { buildChatSystemPrompt } from "@/lib/ai/personality";
import {
  CHAT_REQUEST_TIMEOUT_MS,
  DOCS_CHECKED_DATE,
  MAX_TOOL_ROUNDS,
  OPENROUTER_SETUP_HINT,
  getOpenRouterApiKey,
  getRealtimeModel,
  getRealtimeVoice,
  getTextModel,
  isOpenRouterConfigured,
} from "@/lib/config/models";
import { TOOL_DEFINITIONS } from "@/lib/tools/definitions";
import { executeTool, type ToolContext } from "@/lib/tools/handlers";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const InboundMessage = z.object({
  role: z.enum(["user", "assistant", "system"]),
  content: z.string().max(20000),
});

const ChatBody = z.object({
  messages: z.array(InboundMessage).min(1).max(100),
  apiKey: z.string().optional(),
  /** Conversation register: "daily" (default) or "builder". */
  mode: z.enum(["daily", "builder"]).optional(),
  model: z.string().optional(),
  conversationId: z.string().max(200).optional(),
  notes: z
    .array(
      z.object({
        id: z.string().max(200).optional(),
        title: z.string().max(500),
        body: z.string().max(20000),
      }),
    )
    .max(200)
    .optional(),
  memories: z
    .array(
      z.object({
        text: z.string().max(4000),
        enabled: z.boolean().optional(),
      }),
    )
    .max(100)
    .optional(),
  memorySummary: z.string().max(8000).optional(),
});

const OPENROUTER_TOOLS: ChatCompletionTool[] = TOOL_DEFINITIONS.map((tool) => ({
  type: "function",
  function: {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  },
}));

interface PendingToolCall {
  id: string;
  name: string;
  arguments: string;
}

// Pending call accumulator per tool_call index

const SSE_HEADERS = {
  "content-type": "text/event-stream",
  "cache-control": "no-cache, no-transform",
  connection: "keep-alive",
  "x-accel-buffering": "no",
} as const;

/* ---------- reachability + setup state (never 404 while mounted) ---------- */

/**
 * Read one header value (case-insensitive) off unknown provider error headers.
 * Understands both Headers instances and plain objects; never throws and
 * never touches key material — only retry metadata is read here.
 */
function headerValue(headers: unknown, name: string): string | null {
  if (headers instanceof Headers) return headers.get(name);
  if (headers === null || typeof headers !== "object") return null;
  const want = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== want) continue;
    if (typeof value === "string" && value.length > 0) return value;
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

/**
 * Provider-supplied retry delay in seconds, or null when absent/unparseable.
 * Understands `retry-after` (seconds) and `retry-after-ms` (millis).
 */
function providerRetryAfterSeconds(error: unknown): number | null {
  if (error === null || typeof error !== "object" || !("headers" in error)) {
    return null;
  }
  const headers: unknown = error.headers;
  const secondsRaw = headerValue(headers, "retry-after");
  if (secondsRaw !== null) {
    const seconds = Math.ceil(Number(secondsRaw));
    if (Number.isFinite(seconds) && seconds >= 0 && seconds <= 3600) return seconds;
  }
  const msRaw = headerValue(headers, "retry-after-ms");
  if (msRaw !== null) {
    const ms = Number(msRaw);
    if (Number.isFinite(ms) && ms >= 0 && ms <= 3600_000) {
      return Math.max(1, Math.ceil(ms / 1000));
    }
  }
  return null;
}

/**
 * Error responder for the pre-stream create() call. 429s from OpenRouter keep
 * code "rate_limited"/"quota_exceeded" but gain an actionable hint (provider,
 * wait window, lighter-model suggestion); a provider-supplied retry delay is
 * forwarded as the Retry-After header and mentioned in the hint.
 */
function rateLimitAwareErrorResponse(error: unknown, mapped: SafeApiError) {
  if (mapped.status !== 429) {
    return Response.json(
      { error: mapped.message, code: mapped.code, hint: mapped.hint },
      { status: mapped.status },
    );
  }
  const retryAfter = providerRetryAfterSeconds(error);
  const hint =
    "OpenRouter rate-limited this request — wait ~20-60s, then retry once. " +
    "If it keeps happening, switch to a lighter model in Settings " +
    "(e.g. openai/gpt-4o-mini or google/gemini-2.0-flash-exp:free)." +
    (retryAfter === null
      ? ""
      : ` The provider asked to retry after ~${retryAfter}s.`);
  return Response.json(
    { error: mapped.message, code: mapped.code, hint },
    {
      status: 429,
      ...(retryAfter === null ? {} : { headers: { "Retry-After": String(retryAfter) } }),
    },
  );
}

export async function GET() {
  const configured = isOpenRouterConfigured();
  const defaultModel = getTextModel();
  return Response.json({
    status: configured ? "ready" : "setup-required",
    provider: "openrouter",
    defaultModel,
    serverConfigured: configured,
    openai: { configured },
    models: {
      text: defaultModel,
      realtime: getRealtimeModel(),
      voice: getRealtimeVoice(),
    },
    docsChecked: DOCS_CHECKED_DATE,
    ...(configured ? {} : { hint: OPENROUTER_SETUP_HINT }),
  });
}

export async function OPTIONS() {
  return new Response(null, { status: 204 });
}

/* ------------------------------- chat path ------------------------------- */

export async function POST(request: Request) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return Response.json(
      {
        error: "Request body must be valid JSON.",
        code: "bad_request",
        hint: "Send { messages: [{ role, content }] } with role user/assistant/system.",
      },
      { status: 400 },
    );
  }

  const parsed = ChatBody.safeParse(raw);
  if (!parsed.success) {
    return Response.json(
      {
        error: "Invalid chat request: expected { messages: [{ role, content }] }.",
        code: "bad_request",
        hint: "Roles must be user/assistant/system and content must be text.",
      },
      { status: 400 },
    );
  }
  const body = parsed.data;

  const effectiveApiKey =
    body.apiKey?.trim() ||
    request.headers.get("x-openrouter-key")?.trim() ||
    getOpenRouterApiKey();

  if (!effectiveApiKey) {
    return Response.json(
      {
        error: "OpenRouter API key is not configured.",
        code: "setup_required",
        hint: OPENROUTER_SETUP_HINT,
      },
      { status: 503 },
    );
  }

  const effectiveModel =
    body.model?.trim() ||
    request.headers.get("x-openrouter-model")?.trim() ||
    getTextModel();

  const client = getOpenRouterClient(effectiveApiKey);
  if (!client) {
    return Response.json(
      {
        error: "OpenRouter API key is not configured.",
        code: "setup_required",
        hint: OPENROUTER_SETUP_HINT,
      },
      { status: 503 },
    );
  }

  const instructions = buildChatSystemPrompt({
    mode: body.mode,
    memorySummary: body.memorySummary,
  });

  // Intentional context window: keep every system message (memory context the
  // frontend chose to share), truncate user/assistant turns to the tail.
  const usable = body.messages.filter((m) => m.content.trim().length > 0);
  if (usable.length === 0) {
    return Response.json(
      {
        error: "No message text to answer.",
        code: "bad_request",
        hint: "Send at least one non-empty message.",
      },
      { status: 400 },
    );
  }
  const system = usable.filter((m) => m.role === "system");
  const turns = usable.filter((m) => m.role !== "system");
  const { window, omitted } = truncateToWindow(turns);

  const formattedMessages: ChatCompletionMessageParam[] = [
    { role: "system", content: instructions },
  ];
  const notice = truncationNotice(omitted);
  if (notice) formattedMessages.push({ role: "system", content: notice });
  for (const m of system.slice(-12)) {
    formattedMessages.push({ role: "system", content: m.content });
  }
  for (const m of window) {
    formattedMessages.push({
      role: m.role === "assistant" ? "assistant" : "user",
      content: m.content,
    });
  }
  const toolCtx: ToolContext = {
    notes: (body.notes ?? []).map((n) => ({
      id: n.id,
      title: n.title,
      body: n.body,
    })),
    memories: (body.memories ?? []).map((m) => ({
      text: m.text,
      enabled: m.enabled,
    })),
  };

  // Combined abort: client disconnect ends the stream quietly; our own
  // timeout surfaces as an honest in-band message.
  const aborter = new AbortController();
  const onClientAbort = () => aborter.abort();
  request.signal.addEventListener("abort", onClientAbort);
  const timer = setTimeout(() => aborter.abort(), CHAT_REQUEST_TIMEOUT_MS);
  const signal = aborter.signal;

  // Fail fast: the first create() runs before headers go out, so auth/quota/
  // model errors still return proper JSON statuses.
  let firstStream;
  try {
    firstStream = await client.chat.completions.create(
      {
        model: effectiveModel,
        messages: formattedMessages,
        tools: OPENROUTER_TOOLS,
        stream: true,
      },
      { signal },
    );
  } catch (error) {
    clearTimeout(timer);
    request.signal.removeEventListener("abort", onClientAbort);
    if (request.signal.aborted) return new Response(null, { status: 499 });
    return rateLimitAwareErrorResponse(error, mapOpenAIError(error));
  }

  const sse = new ReadableStream<Uint8Array>({
    start(streamController) {
      const encoder = new TextEncoder();
      const send = (obj: unknown) => {
        streamController.enqueue(
          encoder.encode(`data: ${JSON.stringify(obj)}\n\n`),
        );
      };
      const sendToken = (token: string) => {
        if (token) send({ token });
      };
      const finish = () => {
        streamController.enqueue(encoder.encode("data: [DONE]\n\n"));
        streamController.close();
      };

      void (async () => {
        let active: Stream<ChatCompletionChunk> = firstStream;
        const conversationMessages: ChatCompletionMessageParam[] = [...formattedMessages];
        try {
          for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
            if (signal.aborted) break;
            const toolCallBuffers = new Map<number, PendingToolCall>();
            let roundContent = "";

            for await (const chunk of active) {
              if (signal.aborted) break;
              const choice = chunk.choices?.[0];
              if (!choice) continue;

              const delta = choice.delta;
              if (!delta) continue;

              if (delta.content) {
                roundContent += delta.content;
                sendToken(delta.content);
              }

              if (delta.tool_calls) {
                for (const tc of delta.tool_calls) {
                  const index = tc.index;
                  const existing = toolCallBuffers.get(index) ?? {
                    id: "",
                    name: "",
                    arguments: "",
                  };
                  if (tc.id) existing.id += tc.id;
                  if (tc.function?.name) existing.name += tc.function.name;
                  if (tc.function?.arguments) existing.arguments += tc.function.arguments;
                  toolCallBuffers.set(index, existing);
                }
              }
            }

            const executedCalls = [...toolCallBuffers.values()].filter(
              (c) => c.id && c.name,
            );
            if (executedCalls.length === 0) {
              // Model gave plain text response, no tool calls to execute
              break;
            }

            // Append assistant message with tool calls to conversation history
            conversationMessages.push({
              role: "assistant",
              content: roundContent || null,
              tool_calls: executedCalls.map((c) => ({
                id: c.id,
                type: "function" as const,
                function: {
                  name: c.name,
                  arguments: c.arguments,
                },
              })),
            });

            // Execute each tool call and emit ui actions
            for (const call of executedCalls) {
              if (signal.aborted) break;
              const outcome = await executeTool(call.name, call.arguments, toolCtx);
              conversationMessages.push({
                role: "tool",
                tool_call_id: call.id,
                content: outcome.result,
              });
              if (outcome.ui) send({ ui: outcome.ui });
            }

            if (signal.aborted) break;

            // Force the follow-up: some OpenRouter models end the turn after
            // tool results instead of answering, leaving the user with action
            // but no reply. Nudging for the summary keeps action + words together.
            conversationMessages.push({
              role: "user",
              content:
                "Summarize what you just did in one or two short sentences, in your own voice.",
            });
            try {
              active = await client.chat.completions.create(
                {
                  model: effectiveModel,
                  messages: conversationMessages,
                  tools: OPENROUTER_TOOLS,
                  stream: true,
                },
                { signal },
              );
            } catch (error) {
              const mapped = mapOpenAIError(error);
              sendToken(
                `\n\n[E.V. connection issue — ${mapped.message} ${mapped.hint}]`,
              );
              break;
            }
          }
          finish();
        } catch (error) {
          if (request.signal.aborted) {
            try {
              streamController.close();
            } catch {
              /* client gone */
            }
          } else {
            const mapped = mapOpenAIError(error);
            const timedOut =
              error instanceof Error && error.name === "AbortError";
            sendToken(
              timedOut
                ? `\n\n[E.V. timed out waiting for the provider. Retry with a shorter message.]`
                : `\n\n[E.V. connection issue — ${mapped.message} ${mapped.hint}]`,
            );
            finish();
          }
        } finally {
          clearTimeout(timer);
          request.signal.removeEventListener("abort", onClientAbort);
        }
      })();
    },
    cancel() {
      aborter.abort();
    },
  });

  return new Response(sse, { headers: SSE_HEADERS });
}
