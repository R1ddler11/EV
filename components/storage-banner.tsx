/* Storage failure banner: surfaces IndexedDB quota/unavailability with
   next steps. Hidden when storage is healthy. */
"use client";

import { useEv } from "@/lib/store";

export default function StorageBanner() {
  const { storageError, dismissStorageError } = useEv();
  if (!storageError) return null;
  return (
    <div className="ev-banner ev-banner-error" role="alert" style={{ marginBottom: 14 }}>
      <span>
        <strong>Local storage issue.</strong> {storageError} Conversations and
        notes may not survive a reload until this is resolved.
      </span>
      <button
        type="button"
        className="ev-btn ev-btn-sm ev-btn-ghost"
        onClick={dismissStorageError}
      >
        Dismiss
      </button>
    </div>
  );
}
