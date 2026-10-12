/* PROJECT E.V. — honest cloud-status pill (frontend-owned).
   Three states, never two: Online (route mounted + key configured),
   Setup needed (mounted, no key — chat will 503 with setup hint),
   Offline (route missing or unreachable).
   Clickable to open Model & Key Settings dialog. */
"use client";

import { useEv } from "@/lib/store";
import { StatusPill } from "./ui";

export default function CloudPill() {
  const {
    backendReachable,
    backendConfigured,
    backendHint,
    openRouterApiKey,
    openSettings,
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
    <button
      type="button"
      onClick={openSettings}
      title="Click to configure API Key & Model"
      aria-label="Open model and API key settings"
      style={{
        background: "transparent",
        border: "none",
        padding: 0,
        margin: 0,
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
      }}
    >
      {pillContent}
    </button>
  );
}
