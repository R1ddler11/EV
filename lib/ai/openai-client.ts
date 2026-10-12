/* PROJECT E.V. — server-only OpenAI client factory (backend-owned).
   The permanent API key lives in process env and is only ever attached to
   server-side SDK calls. This module must never be imported by client code. */

import OpenAI from "openai";
import {
  getOpenAIApiKey,
  getOpenRouterApiKey,
  OPENROUTER_BASE_URL,
  OPENROUTER_DEFAULT_HEADERS,
} from "../config/models";
let cachedKey: string | null = null;
let cachedClient: OpenAI | null = null;

/** Null when no key is configured — callers answer 503 with a setup hint. */
export function getServerOpenAI(): OpenAI | null {
  const key = getOpenAIApiKey();
  if (!key) return null;
  if (!cachedClient || cachedKey !== key) {
    cachedKey = key;
    cachedClient = new OpenAI({ apiKey: key, maxRetries: 1 });
  }
  return cachedClient;
}

/** Creates an OpenAI SDK client configured for OpenRouter. */
export function getOpenRouterClient(customApiKey?: string): OpenAI | null {
  const key = customApiKey?.trim() || getOpenRouterApiKey();
  if (!key) return null;
  return new OpenAI({
    apiKey: key,
    baseURL: OPENROUTER_BASE_URL,
    defaultHeaders: OPENROUTER_DEFAULT_HEADERS,
    maxRetries: 1,
  });
}
