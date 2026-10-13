# Changelog — PROJECT E.V.

## v2.0.0 — 2026-10-13

The full-website rework: black/elegant shell, chat orb as the home centerpiece,
OpenRouter-first voice, and a settings page replacing the modal.

### Website shell
- Sticky top bar (brand | nav | LOCAL + CLOUD status pills + settings gear);
  bottom bar on mobile. Sidebar layout removed.
- Home is a full-viewport MorphOrb hero running real streaming turns through
  the shared `use-orb-turn` hook; restrained status, diagnostics, activity,
  and quick-action sections below.
- Voice page goes full-bleed: the WebGL orb fills the viewport, transcript,
  controls, and saved recordings below.
- New `/studio` page: real capability cards with route actions and an honest
  "no external integrations" empty state.

### Voice — OpenRouter-first, no OpenAI key required
- Local path is default with an OpenRouter key: free speech dictation in,
  OpenRouter chat, OpenRouter Fish voice out (active voice from Settings,
  `allowFallback` to free voice on billing/rate-limit failure).
- Dictation waits for real end-of-speech: 1.2s pauses settle the visible
  draft, the turn fires on recognizer end / 6s silence / Send-now button.
- Replies play back audibly (`<audio>` element), tee into the session
  recorder (E.V.'s voice only), and re-arm the mic for the next turn.
- Mute gates the recognizer, not just the stream. Barge-in stops reply audio.
- Every assistant transcript line keeps its TTS blob with its own
  Save-voice button; session-wide save unchanged.
- GSAP stage choreography: orb entrance, speaking swell, staggered controls,
  breathing interim text. Reduced-motion safe throughout.
- Realtime WebRTC path kept for `OPENAI_API_KEY` holders.

### Settings page replaces the modal
- Full `/settings` page (Conversation / Voice / Advanced / About) with every
  real control ported: chat register, speak-aloud + voice picker, transcript
  persistence, free + Fish voice chooser, premium provider keys, OpenRouter
  key + model override, memory toggle, wake word.
- 1,961-line `settings-modal.tsx` deleted at zero importers.

### Honest errors
- Upstream OpenRouter 502s surface as `model_overloaded` with retry guidance;
  unreachable models surface as `model_unavailable` naming Settings.
- Missing OpenRouter key says exactly where to add it.
- Default text model is `openai/gpt-4o-mini` (works on free keys).

### Fixes in this release
- Orb answer card unclamped (was cut at 2 lines) and widened to
  `min(560px, 92vw)`.
- Voice mute toggle rebuilt as a 44px circular tap target.
- GuideCard `asChild` Slot/Fragment warning eliminated.
- Tool calls (e.g. opening Spotify) now force a spoken follow-up reply.

## v0.1.0 — initial commit
- Personal AI companion: assistant, voice mode, diagnostics simulation,
  local memory. Daily/builder chat registers, realtime voice with barge-in,
  E.V.-voice-only recordings, IndexedDB persistence.
