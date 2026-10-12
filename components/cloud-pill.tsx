/* PROJECT E.V. — honest cloud-status pill (frontend-owned).
   Three states, never two: Online (route mounted + key configured),
   Setup needed (mounted, no key — chat will 503 with setup hint),
   Offline (route missing or unreachable).
   Clickable: opens /settings (model & key configuration). */
"use client";

import Link from "next/link";
import { useEv } from "@/lib/store";
import { StatusPill } from "./ui";

export default function CloudPill() {
  const {
    backendReachable,
    backendConfigured,
    backendHint,
    openRouterApiKey,
  } = useEv();

  const hasCustomKey = Boolean(openRouterApiKey?.trim());
  const hasServerKey = Boolean(backendConfigured);

  let pillContent: React.ReactNode;
  if (hasCustomKey) {
    if (backendReachable === false) {
      pillContent = <StatusPill tone="bad">Cloud AI · Offline</StatusPill>;
    } else if (backendReachable === true) {
      pillContent = <StatusPill tone="ok">Cloud AI · Online</StatusPill>;
    } else {
      // Probing with custom key already set
      pillContent = <StatusPill tone="ok">Cloud AI · Online (Custom Key)</StatusPill>;
    }
  } else if (hasServerKey) {
    if (backendReachable === false) {
      pillContent = <StatusPill tone="bad">Cloud AI · Offline</StatusPill>;
    } else if (backendReachable === true) {
      pillContent = <StatusPill tone="ok">Cloud AI · Online</StatusPill>;
    } else {
      pillContent = <StatusPill tone="mute">Cloud AI · Initializing…</StatusPill>;
    }
  } else {
    // No UI key and no server key
    if (backendReachable === true) {
      pillContent = (
        <span title={backendHint ?? "Setup needed: Click to enter OpenRouter API key"}>
          <StatusPill tone="warn">Cloud AI · Setup needed</StatusPill>
        </span>
      );
    } else if (backendReachable === false) {
      pillContent = <StatusPill tone="bad">Cloud AI · Offline</StatusPill>;
    } else {
      pillContent = <StatusPill tone="mute">Cloud AI · Initializing…</StatusPill>;
    }
  }

  return (
    <Link
      href="/settings"
      title="Configure API key & model — Settings"
      aria-label="Open model and API key settings"
      style={{ display: "inline-flex", alignItems: "center" }}
    >
      {pillContent}
    </Link>
  );
}
