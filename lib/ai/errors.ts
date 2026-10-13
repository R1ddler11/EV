/* PROJECT E.V. — safe OpenRouter error mapping (backend-owned, OpenAI SDK shape).
   Every error crossing to the client is sanitized: no stack traces, no key
   material, no raw provider payloads. Only { error, code, hint } shapes leave
   the server. */

import OpenAI from "openai";

export interface SafeApiError {
  status: number;
  code: string;
  message: string;
  hint: string;
}

const SECRET_PATTERN = /\b(sk-[A-Za-z0-9-_]{4,}|ek_[A-Za-z0-9-_]{4,})\b/g;

/** Strip anything shaped like an API key / ephemeral token from text. */
export function sanitizeDetail(text: string): string {
  return text.replace(SECRET_PATTERN, "[redacted]");
}

function base(
  status: number,
  code: string,
  message: string,
  hint: string,
): SafeApiError {
  return { status, code, message: sanitizeDetail(message), hint };
}

/** True when OUR side aborted (timeout). Client disconnects are handled by the caller. */
export function isTimeoutError(error: unknown): boolean {
  return (
    error instanceof OpenAI.APIConnectionTimeoutError ||
    (error instanceof Error && /timed out|timeout/i.test(error.message))
  );
}

export function mapOpenAIError(error: unknown): SafeApiError {
  if (error instanceof OpenAI.AuthenticationError) {
    return base(
      401,
      "invalid_credentials",
      "The API key was rejected by the AI provider.",
      "Check your API key in Settings or OPENROUTER_API_KEY in .env.local.",
    );
  }
  if (error instanceof OpenAI.NotFoundError) {
    return base(
      502,
      "model_unavailable",
      "The configured AI model is unavailable.",
      "The model ID may be retired or not enabled for this key — verify the model ID in Settings or .env.local.",
    );
  }
  if (error instanceof OpenAI.RateLimitError) {
    const detail = sanitizeDetail(
      error.message ?? "Rate limit or quota exhausted.",
    );
    const quota = /insufficient_quota|quota|billing/i.test(detail);
    return quota
      ? base(
          429,
          "quota_exceeded",
          "The OpenRouter account is out of quota or credits.",
          "Top up credits on your OpenRouter account (https://openrouter.ai), then retry. E.V. keeps working locally (notes, history) meanwhile.",
        )
      : base(
          429,
          "rate_limited",
          "OpenRouter rate-limited this request. Nothing was lost.",
          "OpenRouter is throttling this key right now — wait ~20-60s, then retry once. If it repeats, switch to a lighter model in Settings (e.g. openai/gpt-4o-mini or google/gemini-2.0-flash-exp:free).",
        );
  }
  if (error instanceof OpenAI.BadRequestError) {
    return base(
      502,
      "provider_rejected",
      "OpenRouter rejected the request parameters.",
      sanitizeDetail(error.message).slice(0, 300) ||
        "Retry with shorter input; report this if it persists.",
    );
  }
  if (error instanceof OpenAI.APIError) {
    if (
      error.status === 502 ||
      /bad gateway|upstream|overloaded|try again later/i.test(error.message ?? "")
    ) {
      return base(
        502,
        "model_overloaded",
        "OpenRouter's model endpoint is down or overloaded right now.",
        "This is upstream, not your key: check https://status.openrouter.ai, wait ~1-2 min and retry. If it repeats on this model, switch models in Settings → Advanced (e.g. anthropic/claude-3.5-sonnet or openai/gpt-4o-mini). Your text is preserved — nothing was sent.",
      );
    }
    return base(
      error.status >= 500 || error.status === 0 ? 502 : error.status,
      "provider_error",
      "The AI provider returned an error.",
      "Retry shortly. If it persists, check https://status.openrouter.ai.",
    );
  }
  if (isTimeoutError(error)) {
    return base(
      504,
      "upstream_timeout",
      "The AI provider took too long to respond.",
      "Retry — shorter messages answer faster on this box.",
    );
  }
  if (error instanceof Error) {
    return base(
      500,
      "internal",
      "The backend hit an unexpected error.",
      sanitizeDetail(error.message).slice(0, 200) ||
        "Retry; the server log has details.",
    );
  }
  return base(500, "internal", "The backend hit an unexpected error.", "Retry.");
}
