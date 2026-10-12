/* PROJECT E.V. — Studio (frontend-owned).
   A showcase of the console's real capabilities. Every card points
   at the surface where the behavior actually lives; the integrations
   section is an honest empty state — E.V. runs entirely on this box.
   GSAP drives the panel entrance (the same .ev-enter pattern as the
   overview); motion is skipped under prefers-reduced-motion or the
   manual override. */
"use client";

import { useRef } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import {
  Brain,
  LayoutDashboard,
  MessagesSquare,
  Mic,
  Stethoscope,
  Volume2,
} from "lucide-react";
import { SectionLabel } from "@/components/ui";
import { FeatureCard, GuideCard } from "@/components/ui/settings";
import { useEv } from "@/lib/store";
import { motionAllowed } from "@/lib/motion";

export default function StudioPage() {
  const root = useRef<HTMLDivElement>(null);
  const { ready, settings } = useEv();
  const reduced = !motionAllowed(settings.reducedMotionOverride);

  useGSAP(
    () => {
      if (reduced || !root.current) return;
      const ctx = gsap.context(() => {
        gsap.from(".ev-enter", {
          opacity: 0,
          y: 18,
          duration: 0.6,
          stagger: 0.08,
          ease: "power2.out",
          clearProps: "all",
        });
      }, root);
      return () => ctx.revert();
    },
    { scope: root, dependencies: [ready] },
  );

  return (
    <div className="ev-stack" ref={root}>
      <header className="ev-page-head">
        <SectionLabel>E.V. // Studio</SectionLabel>
        <h1 className="ev-h1">Studio</h1>
        <p className="ev-hint">
          What E.V. can do — every capability below lives on a real surface of
          this console.
        </p>
      </header>

      <section aria-labelledby="studio-features">
        <h2 id="studio-features" className="ev-label">
          Features
        </h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <FeatureCard
            className="ev-enter"
            icon={Mic}
            title="Hands-free voice"
            description="One gesture opens a realtime session: the mic stays hot, server-side VAD ends turns, and talking over E.V. interrupts her."
            action={{ label: "Open Voice mode", href: "/voice" }}
          />
          <FeatureCard
            className="ev-enter"
            icon={Volume2}
            title="Saved voice recordings"
            description="E.V.'s spoken replies are captured — her realtime audio track, never your microphone — then listed, playable, renamable and deletable."
            action={{ label: "Hear the recordings", href: "/voice" }}
          />
          <FeatureCard
            className="ev-enter"
            icon={Brain}
            title="Notes & memories"
            description="The vault: notes, user-approved memories, conversations and a full activity ledger — all in browser-local IndexedDB."
            action={{ label: "Open the vault", href: "/memory" }}
          />
          <FeatureCard
            className="ev-enter"
            icon={MessagesSquare}
            title="Daily & builder conversation"
            description="Streaming chat in two registers — resting daily talk or the builder console — with follow-up chips and optional speak-aloud."
            action={{ label: "Start a conversation", href: "/assistant" }}
          />
          <FeatureCard
            className="ev-enter"
            icon={Stethoscope}
            title="Diagnostics"
            description="A deterministic, seeded sweep of the console's subsystems — labelled simulated, never guessed."
            action={{ label: "Run the sweep", href: "/diagnostics" }}
          />
        </div>
      </section>

      <section aria-labelledby="studio-integrations">
        <h2 id="studio-integrations" className="ev-label">
          Integrations
        </h2>
        <div className="ev-empty mt-3">
          <span>E.V. runs entirely on this box — no external integrations yet.</span>
          <span className="ev-hint">
            The only network surfaces are your own backend worker (/api/chat and
            /api/voice). No third-party accounts, no trackers.
          </span>
        </div>
      </section>

      <section aria-labelledby="studio-guides">
        <h2 id="studio-guides" className="ev-label">
          Guides
        </h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <GuideCard
            className="ev-enter"
            icon={LayoutDashboard}
            title="Console areas"
            description="README §Areas — the route map: every surface in the console and what it does."
            href="/"
          />
          <GuideCard
            className="ev-enter"
            icon={MessagesSquare}
            title="Text chat & tools"
            description="README §API setup — POST /api/chat streams SSE tokens; conversationId, mode, notes and memories ride along. Real tools: save_note, search_notes, get_memories."
            href="/assistant"
          />
          <GuideCard
            className="ev-enter"
            icon={Mic}
            title="Realtime voice"
            description="README §API setup §Voice — an ephemeral Realtime secret, WebRTC, semantic VAD, barge-in and the automatic 10-minute renewal."
            href="/voice"
          />
          <GuideCard
            className="ev-enter"
            icon={Brain}
            title="Local-first architecture"
            description="README §Architecture — browser-local IndexedDB via the idb wrapper: zero DB server, no secrets stored client-side."
            href="/memory"
          />
          <GuideCard
            className="ev-enter"
            icon={Stethoscope}
            title="Tools, real vs simulated"
            description="README §Tools — which tool calls really execute, which are simulated, and how the marking is relayed to you."
            href="/diagnostics"
          />
        </div>
      </section>
    </div>
  );
}
