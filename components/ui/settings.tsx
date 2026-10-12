"use client";

// Settings layout authored from the task brief (the original
// 21st.dev component could not be located). Linear-style settings
// shell: section rail + content, three card patterns —
// FeatureCard (capability), IntegrationCard (connection with
// status + action), GuideCard (documentation link, polymorphic
// via Slot).

import { Slot } from "@radix-ui/react-slot";
import { cva } from "class-variance-authority";
import {
  ArrowUpRight,
  Brain,
  GitBranch,
  Keyboard,
  Link2,
  MessageSquare,
  Mic,
  ShieldCheck,
  Sparkles,
  Unplug,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* Card patterns                                                       */
/* ------------------------------------------------------------------ */

const cardVariants = cva("rounded-[10px] border p-4", {
  variants: {
    variant: {
      feature: "border-ev-line",
      integration: "border-ev-line",
      guide:
        "border-ev-line transition-colors hover:border-ev-line2",
    },
  },
  defaultVariants: { variant: "feature" },
});

export interface FeatureCardProps {
  icon: LucideIcon;
  title: string;
  description: string;
  /** Optional real destination, rendered as a small ghost button. */
  action?: { label: string; href: string };
  className?: string;
}

export function FeatureCard({ icon: Icon, title, description, action, className }: FeatureCardProps) {
  return (
    <div className={cn(cardVariants({ variant: "feature" }), className)}>
      <Icon className="size-4 text-ev-muted" aria-hidden="true" />
      <h3 className="text-[13.5px] font-semibold text-ev-ink">{title}</h3>
      <p className="text-[12.5px] leading-relaxed text-ev-muted">{description}</p>
      {action && (
        <a href={action.href} className="ev-btn ev-btn-sm ev-btn-ghost mt-2">
          {action.label}
        </a>
      )}
    </div>
  );
}

export interface IntegrationCardProps {
  icon: LucideIcon;
  title: string;
  description: string;
  status: "connected" | "disconnected";
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
}

export function IntegrationCard({
  icon: Icon,
  title,
  description,
  status,
  actionLabel,
  onAction,
  className,
}: IntegrationCardProps) {
  const connected = status === "connected";
  return (
    <div className={cn(cardVariants({ variant: "integration" }), "flex items-center gap-3", className)}>
      <Icon className="size-4 flex-none text-ev-muted" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className="text-[13.5px] font-semibold text-ev-ink">{title}</h3>
          <span className={cn("ev-pill", connected ? "ev-pill-ok" : "ev-pill-mute")}>
            {connected ? "Connected" : "Offline"}
          </span>
        </div>
        <p className="mt-0.5 text-[12.5px] text-ev-muted">{description}</p>
      </div>
      {actionLabel && (
        <button
          type="button"
          onClick={onAction}
          className={cn("ev-btn ev-btn-sm", connected ? "ev-btn-ghost" : "ev-btn-primary")}
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}

export interface GuideCardProps
  extends Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "children"> {
  icon: LucideIcon;
  title: string;
  description: string;
  asChild?: boolean;
  children?: React.ReactNode;
}

export function GuideCard({ icon: Icon, title, description, asChild, className, ...rest }: GuideCardProps) {
  const inner = (
    <>
      <Icon className="size-4 mt-0.5 flex-none text-ev-muted" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-[13.5px] font-semibold text-ev-ink">
          {title}
          <ArrowUpRight
            className="size-3 text-ev-faint transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
            aria-hidden="true"
          />
        </span>
        <span className="mt-0.5 block text-[12.5px] leading-relaxed text-ev-muted">
          {description}
        </span>
      </span>
    </>
  );

  if (asChild) {
    return (
      <Slot className={cn(cardVariants({ variant: "guide" }), "group flex items-start gap-3", className)} {...rest}>
        {inner}
      </Slot>
    );
  }

  return (
    <a
      className={cn(cardVariants({ variant: "guide" }), "group flex items-start gap-3", className)}
      {...rest}
    >
      {inner}
    </a>
  );
}

/* ------------------------------------------------------------------ */
/* Settings shell                                                      */
/* ------------------------------------------------------------------ */

const SECTIONS = [
  { id: "features", label: "Features" },
  { id: "integrations", label: "Integrations" },
  { id: "guides", label: "Guides" },
] as const;

const sectionVariants = cva("text-[12.5px] rounded-[8px] px-3 py-2 transition-colors", {
  variants: {
    active: {
      true: "text-ev-ink border border-ev-line2",
      false: "text-ev-muted border border-transparent hover:text-ev-ink hover:border-ev-line",
    },
  },
  defaultVariants: { active: false },
});

export interface SettingsProps {
  className?: string;
  activeSection?: (typeof SECTIONS)[number]["id"];
  onIntegrationAction?: (id: string) => void;
}

export default function Settings({ className, activeSection = "features", onIntegrationAction }: SettingsProps) {
  return (
    <div className={cn("grid gap-8 lg:grid-cols-[180px_1fr]", className)}>
      <nav className="ev-stack" style={{ gap: 2 }} aria-label="Settings sections">
        {SECTIONS.map((section) => (
          <a
            key={section.id}
            href={`#${section.id}`}
            className={sectionVariants({ active: activeSection === section.id })}
          >
            {section.label}
          </a>
        ))}
      </nav>

      <div className="ev-stack" style={{ gap: 28 }}>
        <section id="features" aria-labelledby="features-heading">
          <h2 id="features-heading" className="ev-label">
            Features
          </h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <FeatureCard
              icon={Sparkles}
              title="Thinking orb"
              description="A particle orb that thinks out loud — launch, assemble, resolve, and unfold its answer in front of you."
            />
            <FeatureCard
              icon={Mic}
              title="Voice link"
              description="Speak to E.V. and watch the orb respond to the energy of your voice in real time."
            />
            <FeatureCard
              icon={Brain}
              title="Memory vault"
              description="Conversations, prompts, and diagnostics stay local in IndexedDB. Nothing leaves the machine."
            />
            <FeatureCard
              icon={ShieldCheck}
              title="Local-first"
              description="Every transcript and recording is stored on-device with a typed store and an activity ledger."
            />
          </div>
        </section>

        <section id="integrations" aria-labelledby="integrations-heading">
          <h2 id="integrations-heading" className="ev-label">
            Integrations
          </h2>
          <div className="ev-stack" style={{ gap: 10 }}>
            <IntegrationCard
              icon={MessageSquare}
              title="OpenAI Realtime"
              description="Streaming voice and text through the Realtime API."
              status="connected"
              actionLabel="Configure"
              onAction={() => onIntegrationAction?.("openai-realtime")}
            />
            <IntegrationCard
              icon={Link2}
              title="OpenRouter"
              description="Route prompts through OpenRouter to reach any model."
              status="disconnected"
              actionLabel="Connect"
              onAction={() => onIntegrationAction?.("openrouter")}
            />
            <IntegrationCard
              icon={Unplug}
              title="Edge TTS"
              description="Synthesize answers with edge-hosted voices."
              status="disconnected"
              actionLabel="Connect"
              onAction={() => onIntegrationAction?.("edge-tts")}
            />
          </div>
        </section>

        <section id="guides" aria-labelledby="guides-heading">
          <h2 id="guides-heading" className="ev-label">
            Guides
          </h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <GuideCard
              icon={Mic}
              title="Voice setup"
              description="Grant microphone access and tune voice sensitivity."
              href="#guides/voice-setup"
            />
            <GuideCard
              icon={Keyboard}
              title="Keyboard control"
              description="Escape to stop a run, Enter to send, Shift+Enter for newlines."
              href="#guides/keyboard"
            />
            <GuideCard
              icon={GitBranch}
              title="Model picker"
              description="Switch models per conversation from the assistant view."
              href="#guides/models"
            />
          </div>
        </section>
      </div>
    </div>
  );
}
