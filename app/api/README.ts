/* PROJECT E.V. — backend route contract (backend-worker-owned).
   This stub documents the shapes the frontend relies on (see lib/api.ts).
   Replace with real handlers without changing URLs or response shapes.
   - GET  /api/chat → 200 { status: "ready" | "setup-required", hint? }.
     Never 404 while mounted. Frontend probe reads `status`, not reachability.
   - POST /api/chat ← { messages, conversationId?, notes?, memories?,
     memorySummary? } → { reply } JSON or SSE (`data: {"token"}` lines,
     `data: {"ui"}` tool-action lines, `data: [DONE]`).
     No key → 503 { error, code: "setup_required", hint }.
   - POST /api/voice/session ← { context?, memories? } → 201
     { clientSecret, expiresAt, realtimeUrl, webrtc, session }.
     No key → 503 setup_required; bad key → 500 invalid_credentials.
*/
export {};
