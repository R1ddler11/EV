/* PROJECT E.V. — voice path: POST /api/voice/session (backend-owned).
   ---------------------------------------------------------------------------
   Uses the permanent OPENAI_API_KEY server-side only to mint an ephemeral
   Realtime client secret (POST /v1/realtime/client_secrets, TTL 10 min).
   Returns ONLY the ephemeral value + session config — the permanent key never
   leaves the server. Response shape is opaque to the frontend by contract.

   Frontend WebRTC flow (documented here so both workers agree):
   1. POST /api/voice/session with optional { context, memories }.
   2. Read { clientSecret, expiresAt, realtimeUrl, session } from the reply.
   3. getUserMedia({ audio: true }) on a user gesture; build RTCPeerConnection,
      add the mic track, create the "oai-events" data channel, create an SDP
      offer, setLocalDescription.
   4. POST the SDP to the realtime URL as text/sdp with
      `Authorization: Bearer <clientSecret>`; apply the SDP answer as the
      remote description. Voice runs over media tracks; transcripts, tool
      calls and session updates arrive on the data channel.
   5. Cleanup on hangup: stop every mic track, close data channel + peer
      connection, clear srcObject. Frontend owns pages/voice cleanup.
   Missing key -> 503 { error, code, hint }. Never leaks secrets or traces.

   Hands-free session shape, per the Realtime conversations guide
   (https://developers.openai.com/api/docs/guides/realtime-conversations,
   checked 2026-10-12) and the openai-node 7.32 type surface:
   - turn_detection: semantic_vad + create_response + interrupt_response, so
     the server decides when a turn ends and a spoken turn cancels the reply
     (barge-in) with no client clicks between turns.
   - audio.input.transcription: on, so the user's own speech reaches the same
     transcript as E.V.'s.
   - noise_reduction far_field: laptop/desk mics.
   - audio.format is deliberately omitted — WebRTC negotiates the codec via SDP.
   Model/voice from env (defaults gpt-realtime-2.1 / marin).
   --------------------------------------------------------------------------- */

import OpenAI from "openai";
import { z } from "zod";

import { mapOpenAIError } from "@/lib/ai/errors";
import { getServerOpenAI } from "@/lib/ai/openai-client";
import { buildVoiceInstructions } from "@/lib/ai/personality";
import {
  REALTIME_WEBRTC_URL,
  SETUP_HINT,
  VOICE_SECRET_TTL_SECONDS,
  getRealtimeModel,
  getRealtimeVoice,
  isOpenAIConfigured,
  isOpenRouterConfigured,
} from "@/lib/config/models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ContextMessage = z.object({
  role: z.enum(["user", "assistant", "system"]),
  content: z.string().max(8000),
});

const VoiceBody = z.object({
  context: z.array(ContextMessage).max(20).optional(),
  memories: z
    .array(z.object({ text: z.string().max(4000) }))
    .max(50)
    .optional(),
});

export async function POST(request: Request) {
  let raw: unknown = {};
  try {
    raw = await request.json();
  } catch {
    /* empty/invalid body is fine — context is optional */
  }
  const parsed = VoiceBody.safeParse(raw);
  if (!parsed.success) {
    return Response.json(
      {
        error: "Invalid voice session request.",
        code: "bad_request",
        hint: "Optional body is { context: [{ role, content }] }.",
      },
      { status: 400 },
    );
  }

  const client = getServerOpenAI();
  if (!client) {
    const openRouterActive = isOpenRouterConfigured();
    return Response.json(
      {
        error: openRouterActive
          ? "OpenAI Realtime WebRTC is not available when using OpenRouter."
          : "Voice link is not connected yet — no OpenAI key on the server.",
        code: "setup_required",
        hint: openRouterActive
          ? "Conversational voice mode is active using OpenRouter with speech synthesis and local dictation."
          : `${SETUP_HINT} Text conversation keeps working meanwhile.`,
      },
      { status: 503 },
    );
  }

  const model = getRealtimeModel();
  const voice = getRealtimeVoice();
  const recent = (parsed.data.context ?? [])
    .filter((m) => m.content.trim().length > 0)
    .slice(-6)
    .map((m) => `${m.role}: ${m.content.trim().slice(0, 500)}`)
    .join("\n");
  const approved = (parsed.data.memories ?? [])
    .map((m) => m.text.trim())
    .filter(Boolean)
    .slice(0, 8)
    .join("\n");
  const instructions = buildVoiceInstructions({
    memorySummary: approved || undefined,
    recentContext: recent || undefined,
  });

  try {
    const secret = await client.realtime.clientSecrets.create({
      expires_after: {
        anchor: "created_at",
        seconds: VOICE_SECRET_TTL_SECONDS,
      },
      session: {
        type: "realtime",
        model,
        instructions,
        output_modalities: ["audio"],
        audio: {
          input: {
            // Hands-free: the server ends the user's turn and cancels the
            // model's answer when the user talks over it.
            turn_detection: {
              type: "semantic_vad",
              eagerness: "auto",
              create_response: true,
              interrupt_response: true,
            },
            transcription: {
              model: "gpt-4o-mini-transcribe",
              language: "en",
            },
            noise_reduction: { type: "far_field" },
          },
          output: { voice },
        },
        // Long hands-free sessions outgrow the context window on their own.
        truncation: "auto",
      },
    });

    return Response.json(
      {
        clientSecret: secret.value,
        expiresAt: secret.expires_at,
        realtimeUrl: REALTIME_WEBRTC_URL,
        webrtc: {
          url: REALTIME_WEBRTC_URL,
          dataChannel: "oai-events",
        },
        session: {
          model,
          voice,
          instructions,
          outputModalities: ["audio"],
          turnDetection: "semantic_vad",
          handsFree: true,
          bargeIn: true,
          inputTranscription: "gpt-4o-mini-transcribe",
        },
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof OpenAI.AuthenticationError) {
      return Response.json(
        {
          error: "Voice link rejected the server's OpenAI key.",
          code: "invalid_credentials",
          hint: "Check OPENAI_API_KEY in .env.local and restart `pnpm dev`.",
        },
        { status: 500 },
      );
    }
    const mapped = mapOpenAIError(error);
    return Response.json(
      { error: mapped.message, code: mapped.code, hint: mapped.hint },
      { status: mapped.status },
    );
  }
}

export async function GET() {
  const configured = isOpenAIConfigured();
  return Response.json({
    status: configured ? "ready" : "setup-required",
    openai: { configured },
    session: configured
      ? {
          model: getRealtimeModel(),
          voice: getRealtimeVoice(),
          realtimeUrl: REALTIME_WEBRTC_URL,
          secretTtlSeconds: VOICE_SECRET_TTL_SECONDS,
          turnDetection: "semantic_vad",
          handsFree: true,
          bargeIn: true,
        }
      : undefined,
    ...(configured ? {} : { hint: SETUP_HINT }),
  });
}