/* PROJECT E.V. — server-safe note store (backend-owned storage layer).
   Single-user box (owner Alfarez): notes saved via the save_note tool persist
   here as JSON under data/ (gitignored). This is the backend record.
   DUAL-WRITE CONTRACT with the frontend (IndexedDB in lib/db.ts):
   - The chat route returns every saved note both as a `data: {"ui":...}` SSE
     event AND inside the assistant's prose, so current and future frontends
     can mirror it into IndexedDB.
   - search_notes searches BOTH notes the frontend includes in the request
     (`notes` field) and this server store, de-duplicated by id.
   Never stores secrets — titles/bodies only. */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface StoredNote {
  id: string;
  title: string;
  body: string;
  createdAt: number;
  updatedAt: number;
  origin: "assistant-tool";
}

export interface SharedNote {
  id?: string;
  title: string;
  body: string;
}

const STORE_DIR = join(process.cwd(), "data");
const STORE_FILE = join(STORE_DIR, "ev-notes.json");

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.floor(Math.random() * 0xffff).toString(36)}`;
}

async function readAll(): Promise<StoredNote[]> {
  try {
    const raw = await readFile(STORE_FILE, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (n): n is StoredNote =>
        typeof n === "object" &&
        n !== null &&
        typeof (n as StoredNote).title === "string",
    );
  } catch {
    return [];
  }
}

async function writeAll(notes: StoredNote[]): Promise<void> {
  await mkdir(STORE_DIR, { recursive: true });
  await writeFile(STORE_FILE, JSON.stringify(notes, null, 2), "utf8");
}

export async function saveServerNote(
  title: string,
  body: string,
): Promise<StoredNote> {
  const now = Date.now();
  const note: StoredNote = {
    id: newId("note"),
    title: title.slice(0, 120),
    body: body.slice(0, 8000),
    createdAt: now,
    updatedAt: now,
    origin: "assistant-tool",
  };
  const notes = await readAll();
  notes.push(note);
  await writeAll(notes);
  return note;
}

export async function searchServerNotes(
  query: string,
  limit: number,
): Promise<StoredNote[]> {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];
  const notes = await readAll();
  return notes
    .filter((n) => {
      const hay = `${n.title}\n${n.body}`.toLowerCase();
      return terms.every((t) => hay.includes(t));
    })
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, Math.max(1, Math.min(20, limit)));
}
