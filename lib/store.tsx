/* PROJECT E.V. — client state store (frontend-owned).
   Single React context holding conversations, notes, memories, settings,
   activity and connection flags. Persists to IndexedDB via lib/db.ts.
   Backend calls go through lib/api.ts; this file never fabricates replies. */
"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  clearActivity as dbClearActivity,
  clearConversations as dbClearConversations,
  clearMemories as dbClearMemories,
  deleteConversation as dbDeleteConversation,
  deleteMemory as dbDeleteMemory,
  deleteNote as dbDeleteNote,
  listActivity,
  listConversations,
  listMemories,
  listNotes,
  loadSettings,
  logActivity,
  PersistenceError,
  saveConversation as dbSaveConversation,
  saveMemory as dbSaveMemory,
  saveNote as dbSaveNote,
  saveSettings as dbSaveSettings,
} from "./db";
import { probeChatRoute } from "./api";
import {
  DEFAULT_SETTINGS,
  newId,
  type ActivityEntry,
  type AppSettings,
  type ChatMessage,
  type ChatMode,
  type CloudStatus,
  type Conversation,
  type CoreState,
  type FishVoicePreset,
  type MemoryItem,
  type Note,
  type VoiceSource,
} from "./types";

interface EvState {
  ready: boolean;
  storageError: string | null;
  conversations: Conversation[];
  activeId: string | null;
  active: Conversation | null;
  notes: Note[];
  memories: MemoryItem[];
  settings: AppSettings;
  activity: ActivityEntry[];
  coreState: CoreState;
  cloudStatus: CloudStatus;
  backendReachable: boolean | null;
  /** Route mounted AND server reports status "ready" (key configured). */
  backendConfigured: boolean | null;
  /** Backend's own setup hint when mounted but unconfigured. */
  backendHint: string | null;
  /** Ephemeral diagnostics-scan request counter (not persisted). */
  scanRequest: number;
  streaming: boolean;
  openRouterApiKey?: string;
  openRouterModel?: string;
  ttsVoice: string;
  fishAudioApiKey: string;
  fishVoiceViaOpenRouter: string;
  activeVoiceSource: VoiceSource;
  fishVoices: string[];
  fishVoicePresets?: FishVoicePreset[];
  elevenLabsApiKey: string;
  elevenLabsVoiceId: string;
  azureSpeechKey: string;
  azureSpeechRegion: string;
  wakeWordEnabled: boolean;
  /** Chat register for /api/chat (persisted preference, default "daily"). */
  chatMode: ChatMode;
  /** Speak-aloud for text-chat replies (persisted, default off). */
  speakReplies: boolean;
  /** speechSynthesis voice URI chosen for the text chat; "" = platform default. */
  speakVoice: string;
  settingsOpen: boolean;
}
interface EvActions {
  newConversation: () => Promise<string>;
  selectConversation: (id: string) => void;
  renameConversation: (id: string, title: string) => Promise<void>;
  removeConversation: (id: string) => Promise<void>;
  clearAllConversations: () => Promise<void>;
  appendMessage: (conversationId: string, message: ChatMessage) => Promise<void>;
  updateMessage: (
    conversationId: string,
    messageId: string,
    content: string,
  ) => Promise<void>;
  setCoreState: (state: CoreState) => void;
  setStreaming: (value: boolean) => void;
  recheckBackend: () => Promise<void>;
  mirrorNote: (note: Note) => Promise<void>;
  requestScan: () => void;
  addNote: (title: string, body: string) => Promise<void>;
  updateNote: (id: string, title: string, body: string) => Promise<void>;
  removeNote: (id: string) => Promise<void>;
  addMemory: (text: string) => Promise<void>;
  updateMemory: (id: string, text: string, enabled: boolean) => Promise<void>;
  removeMemory: (id: string) => Promise<void>;
  clearAllMemories: () => Promise<void>;
  updateSettings: (patch: Partial<AppSettings>) => Promise<void>;
  setOpenRouterApiKey: (key: string) => Promise<void>;
  setOpenRouterModel: (model: string) => Promise<void>;
  setTtsVoice: (voice: string) => Promise<void>;
  setFishAudioApiKey: (key: string) => Promise<void>;
  setFishVoiceViaOpenRouter: (voiceId: string) => Promise<void>;
  setActiveVoiceSource: (source: VoiceSource) => Promise<void>;
  setFishVoices: (voices: string[]) => Promise<void>;
  setFishVoicePresets: (presets: FishVoicePreset[]) => Promise<void>;
  setElevenLabsApiKey: (key: string) => Promise<void>;
  setElevenLabsVoiceId: (voiceId: string) => Promise<void>;
  setAzureSpeechKey: (key: string) => Promise<void>;
  setAzureSpeechRegion: (region: string) => Promise<void>;
  setWakeWordEnabled: (enabled: boolean) => Promise<void>;
  setChatMode: (mode: ChatMode) => Promise<void>;
  setSpeakReplies: (enabled: boolean) => Promise<void>;
  setSpeakVoice: (voiceURI: string) => Promise<void>;
  recordActivity: (
    kind: ActivityEntry["kind"],
    label: string,
    detail?: string,
  ) => Promise<void>;
  clearAllActivity: () => Promise<void>;
  dismissStorageError: () => void;
  openSettings: () => void;
  closeSettings: () => void;
}

const EvContext = createContext<(EvState & EvActions) | null>(null);

function titleFrom(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return "Untitled exchange";
  return clean.length > 44 ? `${clean.slice(0, 44)}…` : clean;
}

export function EvProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [coreState, setCoreState] = useState<CoreState>("idle");
  const [cloudStatus, setCloudStatus] = useState<CloudStatus>("untested");
  const [backendReachable, setBackendReachable] = useState<boolean | null>(null);
  const [backendConfigured, setBackendConfigured] = useState<boolean | null>(null);
  const [backendHint, setBackendHint] = useState<string | null>(null);
  const [scanRequest, setScanRequest] = useState(0);
  const [streaming, setStreaming] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const booted = useRef(false);
  const conversationsRef = useRef<Conversation[]>([]);

  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);
  const noteFailure = useCallback((error: unknown) => {
    if (error instanceof PersistenceError) {
      setStorageError(error.message);
    } else {
      setStorageError(
        error instanceof Error ? error.message : "Storage operation failed.",
      );
    }
  }, []);

  const recheckBackend = useCallback(async () => {
    try {
      const probe = await probeChatRoute();
      setBackendReachable(probe.mounted);
      setBackendConfigured(probe.mounted ? probe.configured : null);
      setBackendHint(probe.hint ?? null);
      setCloudStatus(probe.mounted ? "reachable" : "unreachable");
      setCoreState((prev) => {
        if (prev === "listening" || prev === "processing" || prev === "speaking")
          return prev;
        return probe.mounted ? "idle" : "disconnected";
      });
    } catch {
      setBackendReachable(false);
      setBackendConfigured(null);
      setBackendHint(null);
      setCloudStatus("unreachable");
      setCoreState((prev) => {
        if (prev === "listening" || prev === "processing" || prev === "speaking")
          return prev;
        return "disconnected";
      });
    }
  }, []);

  useEffect(() => {
    // Auto-recheck on window focus, visibility change, or network reconnect
    const handleFocus = () => {
      void recheckBackend();
    };
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        void recheckBackend();
      }
    };
    const handleOnline = () => {
      void recheckBackend();
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("online", handleOnline);
    const intervalId = window.setInterval(() => {
      void recheckBackend();
    }, 30000);

    return () => {
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("online", handleOnline);
      window.clearInterval(intervalId);
    };
  }, [recheckBackend]);

  useEffect(() => {
    if (booted.current) return;
    booted.current = true;

    void recheckBackend();

    (async () => {
      try {
        const [convs, storedNotes, storedMemories, storedSettings, storedAct] =
          await Promise.all([
            listConversations(),
            listNotes(),
            listMemories(),
            loadSettings(),
            listActivity(),
          ]);
        setConversations(convs);
        setNotes(storedNotes);
        setMemories(storedMemories);
        setSettings(storedSettings);
        setActivity(storedAct);
        if (convs.length > 0 && convs[0]) setActiveId(convs[0].id);
      } catch (error) {
        noteFailure(error);
      } finally {
        setReady(true);
      }
    })();
  }, [noteFailure, recheckBackend]);

  const refreshActivity = useCallback(async () => {
    try {
      setActivity(await listActivity());
    } catch (error) {
      noteFailure(error);
    }
  }, [noteFailure]);

  const recordActivity: EvActions["recordActivity"] = useCallback(
    async (kind, label, detail) => {
      try {
        await logActivity({ kind, label, detail });
        await refreshActivity();
      } catch (error) {
        noteFailure(error);
      }
    },
    [noteFailure, refreshActivity],
  );

  const newConversation = useCallback(async (): Promise<string> => {
    const now = Date.now();
    const conversation: Conversation = {
      id: newId("conv"),
      title: "New exchange",
      messages: [],
      createdAt: now,
      updatedAt: now,
    };
    try {
      await dbSaveConversation(conversation);
      setConversations((prev) => [conversation, ...prev]);
      setActiveId(conversation.id);
      return conversation.id;
    } catch (error) {
      noteFailure(error);
      return "";
    }
  }, [noteFailure]);

  const selectConversation = useCallback((id: string) => {
    setActiveId(id);
  }, []);

  const renameConversation = useCallback(
    async (id: string, title: string) => {
      const next = conversations.map((conv) =>
        conv.id === id
          ? { ...conv, title: title.trim() || conv.title, updatedAt: Date.now() }
          : conv,
      );
      setConversations(next);
      const updated = next.find((conv) => conv.id === id);
      if (updated) {
        try {
          await dbSaveConversation(updated);
        } catch (error) {
          noteFailure(error);
        }
      }
    },
    [conversations, noteFailure],
  );

  const removeConversation = useCallback(
    async (id: string) => {
      try {
        await dbDeleteConversation(id);
        setConversations((prev) => {
          const rest = prev.filter((conv) => conv.id !== id);
          if (activeId === id) setActiveId(rest[0]?.id ?? null);
          return rest;
        });
      } catch (error) {
        noteFailure(error);
      }
    },
    [activeId, noteFailure],
  );

  const clearAllConversations = useCallback(async () => {
    try {
      await dbClearConversations();
      setConversations([]);
      setActiveId(null);
    } catch (error) {
      noteFailure(error);
    }
  }, [noteFailure]);

  const appendMessage = useCallback(
    async (conversationId: string, message: ChatMessage) => {
      const current = conversationsRef.current.find((c) => c.id === conversationId);
      if (!current) return;
      const messages = [...current.messages, message];
      const firstUser = messages.find((m) => m.role === "user");
      const updated: Conversation = {
        ...current,
        messages,
        title:
          current.title === "New exchange" && firstUser
            ? titleFrom(firstUser.content)
            : current.title,
        updatedAt: Date.now(),
      };
      setConversations((prev) =>
        prev.map((conv) => (conv.id === conversationId ? updated : conv)),
      );
      try {
        await dbSaveConversation(updated);
      } catch (error) {
        noteFailure(error);
      }
    },
    [noteFailure],
  );

  const updateMessage = useCallback(
    async (conversationId: string, messageId: string, content: string) => {
      const current = conversationsRef.current.find((c) => c.id === conversationId);
      if (!current) return;
      const updated: Conversation = {
        ...current,
        messages: current.messages.map((m) =>
          m.id === messageId ? { ...m, content } : m,
        ),
        updatedAt: Date.now(),
      };
      setConversations((prev) =>
        prev.map((conv) => (conv.id === conversationId ? updated : conv)),
      );
      try {
        await dbSaveConversation(updated);
      } catch (error) {
        noteFailure(error);
      }
    },
    [noteFailure],
  );


  const addNote = useCallback(
    async (title: string, body: string) => {
      const now = Date.now();
      const note: Note = {
        id: newId("note"),
        title: title.trim() || "Untitled note",
        body,
        createdAt: now,
        updatedAt: now,
      };
      try {
        await dbSaveNote(note);
        setNotes((prev) => [note, ...prev]);
        await recordActivity("note", `Note saved — ${note.title}`);
      } catch (error) {
        noteFailure(error);
      }
    },
    [noteFailure, recordActivity],
  );

  /** Upsert a backend tool-saved note into the local vault (no duplicates). */
  const mirrorNote = useCallback(
    async (note: Note) => {
      const full: Note = {
        ...note,
        title: note.title.trim() || "Untitled note",
        createdAt: note.createdAt || Date.now(),
        updatedAt: Date.now(),
      };
      try {
        await dbSaveNote(full);
        setNotes((prev) =>
          prev.some((n) => n.id === full.id)
            ? prev.map((n) => (n.id === full.id ? full : n))
            : [full, ...prev],
        );
        await recordActivity("note", `Note saved — ${full.title}`);
      } catch (error) {
        noteFailure(error);
      }
    },
    [noteFailure, recordActivity],
  );

  const requestScan = useCallback(() => {
    setScanRequest((n) => n + 1);
  }, []);
  const updateNote = useCallback(
    async (id: string, title: string, body: string) => {
      const existing = notes.find((n) => n.id === id);
      if (!existing) return;
      const next: Note = {
        ...existing,
        title: title.trim() || existing.title,
        body,
        updatedAt: Date.now(),
      };
      try {
        await dbSaveNote(next);
        setNotes((prev) => prev.map((n) => (n.id === id ? next : n)));
      } catch (error) {
        noteFailure(error);
      }
    },
    [noteFailure, notes],
  );

  const removeNote = useCallback(
    async (id: string) => {
      try {
        await dbDeleteNote(id);
        setNotes((prev) => prev.filter((n) => n.id !== id));
      } catch (error) {
        noteFailure(error);
      }
    },
    [noteFailure],
  );

  const addMemory = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      const now = Date.now();
      const memory: MemoryItem = {
        id: newId("mem"),
        text: trimmed,
        source: "user-approved",
        enabled: true,
        createdAt: now,
        updatedAt: now,
      };
      try {
        await dbSaveMemory(memory);
        setMemories((prev) => [memory, ...prev]);
        await recordActivity("memory", "Memory approved", trimmed.slice(0, 80));
      } catch (error) {
        noteFailure(error);
      }
    },
    [noteFailure, recordActivity],
  );

  const updateMemory = useCallback(
    async (id: string, text: string, enabled: boolean) => {
      const existing = memories.find((m) => m.id === id);
      if (!existing) return;
      const next: MemoryItem = {
        ...existing,
        text,
        enabled,
        updatedAt: Date.now(),
      };
      try {
        await dbSaveMemory(next);
        setMemories((prev) => prev.map((m) => (m.id === id ? next : m)));
      } catch (error) {
        noteFailure(error);
      }
    },
    [memories, noteFailure],
  );

  const removeMemory = useCallback(
    async (id: string) => {
      try {
        await dbDeleteMemory(id);
        setMemories((prev) => prev.filter((m) => m.id !== id));
      } catch (error) {
        noteFailure(error);
      }
    },
    [noteFailure],
  );

  const clearAllMemories = useCallback(async () => {
    try {
      await dbClearMemories();
      setMemories([]);
    } catch (error) {
      noteFailure(error);
    }
  }, [noteFailure]);

  const updateSettings = useCallback(
    async (patch: Partial<AppSettings>) => {
      const next = { ...settings, ...patch };
      setSettings(next);
      try {
        await dbSaveSettings(next);
      } catch (error) {
        noteFailure(error);
      }
    },
    [noteFailure, settings],
  );

  const setOpenRouterApiKey = useCallback(
    async (key: string) => {
      await updateSettings({ openRouterApiKey: key });
    },
    [updateSettings],
  );

  const setOpenRouterModel = useCallback(
    async (model: string) => {
      await updateSettings({ openRouterModel: model });
    },
    [updateSettings],
  );

  const setTtsVoice = useCallback(
    async (voice: string) => {
      await updateSettings({ ttsVoice: voice });
    },
    [updateSettings],
  );

  const setFishAudioApiKey = useCallback(
    async (key: string) => {
      await updateSettings({ fishAudioApiKey: key });
    },
    [updateSettings],
  );
  const setFishVoiceViaOpenRouter = useCallback(
    async (voiceId: string) => {
      await updateSettings({ fishVoiceViaOpenRouter: voiceId });
    },
    [updateSettings],
  );

  const setActiveVoiceSource = useCallback(
    async (source: VoiceSource) => {
      await updateSettings({ activeVoiceSource: source });
    },
    [updateSettings],
  );

  const setFishVoices = useCallback(
    async (voices: string[]) => {
      await updateSettings({ fishVoices: voices });
    },
    [updateSettings],
  );

  const setFishVoicePresets = useCallback(
    async (presets: FishVoicePreset[]) => {
      await updateSettings({ fishVoicePresets: presets });
    },
    [updateSettings],
  );
  const setElevenLabsApiKey = useCallback(
    async (key: string) => {
      await updateSettings({ elevenLabsApiKey: key });
    },
    [updateSettings],
  );

  const setElevenLabsVoiceId = useCallback(
    async (voiceId: string) => {
      await updateSettings({ elevenLabsVoiceId: voiceId });
    },
    [updateSettings],
  );

  const setAzureSpeechKey = useCallback(
    async (key: string) => {
      await updateSettings({ azureSpeechKey: key });
    },
    [updateSettings],
  );

  const setAzureSpeechRegion = useCallback(
    async (region: string) => {
      await updateSettings({ azureSpeechRegion: region });
    },
    [updateSettings],
  );


  const setWakeWordEnabled = useCallback(
    async (enabled: boolean) => {
      await updateSettings({ wakeWordEnabled: enabled });
    },
    [updateSettings],
  );

  const setChatMode = useCallback(
    async (mode: ChatMode) => {
      await updateSettings({ chatMode: mode });
    },
    [updateSettings],
  );

  const setSpeakReplies = useCallback(
    async (enabled: boolean) => {
      await updateSettings({ speakReplies: enabled });
    },
    [updateSettings],
  );

  const setSpeakVoice = useCallback(
    async (voiceURI: string) => {
      await updateSettings({ speakVoice: voiceURI });
    },
    [updateSettings],
  );

  const clearAllActivity = useCallback(async () => {
    try {
      await dbClearActivity();
      setActivity([]);
    } catch (error) {
      noteFailure(error);
    }
  }, [noteFailure]);

  const dismissStorageError = useCallback(() => setStorageError(null), []);
  const openSettings = useCallback(() => setSettingsOpen(true), []);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);
  const active = useMemo(
    () => conversations.find((conv) => conv.id === activeId) ?? null,
    [conversations, activeId],
  );

  const value = useMemo<EvState & EvActions>(
    () => ({
      ready,
      storageError,
      conversations,
      activeId,
      active,
      notes,
      memories,
      settings,
      activity,
      coreState,
      cloudStatus,
      backendReachable,
      backendConfigured,
      backendHint,
      scanRequest,
      streaming,
      settingsOpen,
      newConversation,
      selectConversation,
      renameConversation,
      removeConversation,
      clearAllConversations,
      appendMessage,
      updateMessage,
      setCoreState,
      setStreaming,
      recheckBackend,
      mirrorNote,
      requestScan,
      addNote,
      updateNote,
      removeNote,
      addMemory,
      updateMemory,
      removeMemory,
      clearAllMemories,
      updateSettings,
      openRouterApiKey: settings.openRouterApiKey,
      openRouterModel: settings.openRouterModel,
      ttsVoice: settings.ttsVoice ?? "",
      fishAudioApiKey: settings.fishAudioApiKey ?? "",
      fishVoiceViaOpenRouter: settings.fishVoiceViaOpenRouter ?? "",
      activeVoiceSource: settings.activeVoiceSource ?? "free",
      fishVoices: settings.fishVoices ?? [],
      fishVoicePresets: settings.fishVoicePresets,
      elevenLabsApiKey: settings.elevenLabsApiKey ?? "",
      elevenLabsVoiceId: settings.elevenLabsVoiceId ?? "",
      azureSpeechKey: settings.azureSpeechKey ?? "",
      azureSpeechRegion: settings.azureSpeechRegion ?? "",
      wakeWordEnabled: settings.wakeWordEnabled ?? false,
      chatMode: settings.chatMode === "builder" ? "builder" : "daily",
      speakReplies: settings.speakReplies ?? false,
      speakVoice: settings.speakVoice ?? "",
      setOpenRouterApiKey,
      setOpenRouterModel,
      setTtsVoice,
      setFishAudioApiKey,
      setFishVoiceViaOpenRouter,
      setActiveVoiceSource,
      setFishVoices,
      setFishVoicePresets,
      setElevenLabsApiKey,
      setElevenLabsVoiceId,
      setAzureSpeechKey,
      setAzureSpeechRegion,
      setWakeWordEnabled,
      setChatMode,
      setSpeakReplies,
      setSpeakVoice,
      recordActivity,
      clearAllActivity,
      dismissStorageError,
      openSettings,
      closeSettings,
    }),
    [
      ready,
      storageError,
      conversations,
      activeId,
      active,
      notes,
      memories,
      settings,
      activity,
      coreState,
      cloudStatus,
      backendReachable,
      backendConfigured,
      backendHint,
      scanRequest,
      streaming,
      newConversation,
      selectConversation,
      renameConversation,
      removeConversation,
      clearAllConversations,
      appendMessage,
      updateMessage,
      recheckBackend,
      mirrorNote,
      requestScan,
      addNote,
      updateNote,
      removeNote,
      addMemory,
      updateMemory,
      removeMemory,
      clearAllMemories,
      updateSettings,
      setOpenRouterApiKey,
      setOpenRouterModel,
      recordActivity,
      clearAllActivity,
      setTtsVoice,
      setFishAudioApiKey,
      setFishVoiceViaOpenRouter,
      setActiveVoiceSource,
      setFishVoices,
      setFishVoicePresets,
      setElevenLabsApiKey,
      setElevenLabsVoiceId,
      setAzureSpeechKey,
      setAzureSpeechRegion,
      setWakeWordEnabled,
      setChatMode,
      setSpeakReplies,
      setSpeakVoice,
      dismissStorageError,
      settingsOpen,
      openSettings,
      closeSettings,
    ],
  );

  return <EvContext.Provider value={value}>{children}</EvContext.Provider>;
}

export function useEv(): EvState & EvActions {
  const ctx = useContext(EvContext);
  if (!ctx) throw new Error("useEv must be used inside EvProvider");
  return ctx;
}
