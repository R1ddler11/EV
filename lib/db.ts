/* PROJECT E.V. — IndexedDB persistence layer (frontend-owned).
   Stores: conversations, notes, memories, settings, activity, recordings.
   No API keys or secrets are ever written here — settings hold UI
   preferences only. Quota / unavailability failures surface as
   PersistenceError so the UI can offer next steps. */

import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import {
  DEFAULT_SETTINGS,
  type ActivityEntry,
  type AppSettings,
  type Conversation,
  type MemoryItem,
  type Note,
  type Recording,
} from "./types";

interface EvSchema extends DBSchema {
  conversations: { key: string; value: Conversation };
  notes: { key: string; value: Note };
  memories: { key: string; value: MemoryItem };
  settings: { key: string; value: AppSettings };
  activity: { key: string; value: ActivityEntry };
  recordings: { key: string; value: Recording };
}

const DB_NAME = "ev-companion";
const DB_VERSION = 2;
const SETTINGS_KEY = "app";
const ACTIVITY_CAP = 200;

let dbPromise: Promise<IDBPDatabase<EvSchema>> | null = null;

function db(): Promise<IDBPDatabase<EvSchema>> {
  if (!dbPromise) {
    dbPromise = openDB<EvSchema>(DB_NAME, DB_VERSION, {
      upgrade(database) {
        if (!database.objectStoreNames.contains("conversations"))
          database.createObjectStore("conversations", { keyPath: "id" });
        if (!database.objectStoreNames.contains("notes"))
          database.createObjectStore("notes", { keyPath: "id" });
        if (!database.objectStoreNames.contains("memories"))
          database.createObjectStore("memories", { keyPath: "id" });
        if (!database.objectStoreNames.contains("settings"))
          database.createObjectStore("settings");
        if (!database.objectStoreNames.contains("activity"))
          database.createObjectStore("activity", { keyPath: "id" });
        if (!database.objectStoreNames.contains("recordings"))
          database.createObjectStore("recordings", { keyPath: "id" });
      },
    });
  }
  return dbPromise;
}

export type PersistenceCode = "quota" | "unavailable" | "unknown";

export class PersistenceError extends Error {
  code: PersistenceCode;
  constructor(code: PersistenceCode, message: string) {
    super(message);
    this.name = "PersistenceError";
    this.code = code;
  }
}

function wrap(error: unknown): PersistenceError {
  if (error instanceof PersistenceError) return error;
  const name =
    error instanceof DOMException
      ? error.name
      : error instanceof Error
        ? error.name
        : "";
  if (name === "QuotaExceededError") {
    return new PersistenceError(
      "quota",
      "Local storage is full. Delete old conversations or notes, then retry.",
    );
  }
  if (
    name === "InvalidStateError" ||
    name === "UnknownError" ||
    name === "NotFoundError"
  ) {
    return new PersistenceError(
      "unavailable",
      "Local storage is unavailable in this browser session. Data will not persist after reload.",
    );
  }
  return new PersistenceError(
    "unknown",
    error instanceof Error ? error.message : "Storage write failed.",
  );
}

function sortKey(row: unknown): number {
  if (row && typeof row === "object") {
    if ("updatedAt" in row && typeof row.updatedAt === "number")
      return row.updatedAt;
    if ("at" in row && typeof row.at === "number") return row.at;
    if ("createdAt" in row && typeof row.createdAt === "number")
      return row.createdAt;
  }
  return 0;
}

async function all<T>(
  store: "conversations" | "notes" | "memories" | "activity" | "recordings",
): Promise<T[]> {
  try {
    const database = await db();
    const rows = (await database.getAll(store)) as T[];
    return rows.sort((a, b) => sortKey(b) - sortKey(a));
  } catch (error) {
    throw wrap(error);
  }
}

/* ---------- conversations ---------- */

export const listConversations = () =>
  all<Conversation>("conversations");

export async function saveConversation(conversation: Conversation) {
  try {
    (await db()).put("conversations", conversation);
  } catch (error) {
    throw wrap(error);
  }
}

export async function deleteConversation(id: string) {
  try {
    (await db()).delete("conversations", id);
  } catch (error) {
    throw wrap(error);
  }
}

export async function clearConversations() {
  try {
    (await db()).clear("conversations");
  } catch (error) {
    throw wrap(error);
  }
}

/* ---------- notes ---------- */

export const listNotes = () => all<Note>("notes");

export async function saveNote(note: Note) {
  try {
    (await db()).put("notes", note);
  } catch (error) {
    throw wrap(error);
  }
}

export async function deleteNote(id: string) {
  try {
    (await db()).delete("notes", id);
  } catch (error) {
    throw wrap(error);
  }
}

/* ---------- memories ---------- */

export const listMemories = () => all<MemoryItem>("memories");

export async function saveMemory(memory: MemoryItem) {
  try {
    (await db()).put("memories", memory);
  } catch (error) {
    throw wrap(error);
  }
}

export async function deleteMemory(id: string) {
  try {
    (await db()).delete("memories", id);
  } catch (error) {
    throw wrap(error);
  }
}

export async function clearMemories() {
  try {
    (await db()).clear("memories");
  } catch (error) {
    throw wrap(error);
  }
}

/* ---------- settings ---------- */

export async function loadSettings(): Promise<AppSettings> {
  try {
    const stored = await (await db()).get("settings", SETTINGS_KEY);
    return { ...DEFAULT_SETTINGS, ...(stored ?? {}) };
  } catch (error) {
    throw wrap(error);
  }
}

export async function saveSettings(settings: AppSettings) {
  try {
    (await db()).put("settings", settings, SETTINGS_KEY);
  } catch (error) {
    throw wrap(error);
  }
}

/* ---------- activity ---------- */

export const listActivity = () => all<ActivityEntry>("activity");

export async function logActivity(
  entry: Omit<ActivityEntry, "id" | "at"> & { at?: number },
) {
  try {
    const database = await db();
    const full: ActivityEntry = {
      ...entry,
      id: `act_${Date.now().toString(36)}_${Math.floor(Math.random() * 0xffff).toString(36)}`,
      at: entry.at ?? Date.now(),
    };
    await database.put("activity", full);
    const rows = await database.getAll("activity");
    if (rows.length > ACTIVITY_CAP) {
      rows.sort((a, b) => a.at - b.at);
      const tx = database.transaction("activity", "readwrite");
      for (const stale of rows.slice(0, rows.length - ACTIVITY_CAP)) {
        await tx.store.delete(stale.id);
      }
      await tx.done;
    }
  } catch (error) {
    throw wrap(error);
  }
}

export async function clearActivity() {
  try {
    (await db()).clear("activity");
  } catch (error) {
    throw wrap(error);
  }
}

/* ---------- recordings ---------- */

export const listRecordings = () => all<Recording>("recordings");

export async function saveRecording(recording: Recording) {
  try {
    (await db()).put("recordings", recording);
  } catch (error) {
    throw wrap(error);
  }
}

export async function deleteRecording(id: string) {
  try {
    (await db()).delete("recordings", id);
  } catch (error) {
    throw wrap(error);
  }
}
