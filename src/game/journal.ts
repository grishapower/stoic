import { create } from 'zustand'

/**
 * Reflection journal. Entries live only in this browser (localStorage) and are
 * never sent anywhere. If storage is unavailable (private mode, quota, blocked
 * cookies) the journal silently falls back to memory for this tab.
 */

export interface JournalEntry {
  id: string
  /** ISO 8601 timestamp. */
  createdAt: string
  text: string
  /** The question the entry answers. */
  prompt: string
}

export const JOURNAL_KEY = 'seneca.journal.v1'
export const DEFAULT_PROMPT = 'На что я трачу своё время?'
const MAX_TEXT_LENGTH = 20000

interface JournalState {
  /** Newest first. */
  entries: JournalEntry[]
  /** False when entries are kept in memory only (storage unavailable). */
  persistent: boolean
}

function getStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null
  } catch {
    return null
  }
}

function isEntry(v: unknown): v is JournalEntry {
  if (!v || typeof v !== 'object') return false
  const e = v as Record<string, unknown>
  return (
    typeof e.id === 'string' &&
    typeof e.createdAt === 'string' &&
    typeof e.text === 'string' &&
    typeof e.prompt === 'string'
  )
}

function readStored(): { entries: JournalEntry[]; persistent: boolean } {
  const storage = getStorage()
  if (!storage) return { entries: [], persistent: false }
  let raw: string | null
  try {
    raw = storage.getItem(JOURNAL_KEY)
  } catch {
    return { entries: [], persistent: false }
  }
  if (!raw) return { entries: [], persistent: true }
  try {
    const parsed: unknown = JSON.parse(raw)
    const entries = Array.isArray(parsed) ? parsed.filter(isEntry) : []
    return { entries: entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt)), persistent: true }
  } catch {
    // Corrupted data: start fresh but keep using storage.
    return { entries: [], persistent: true }
  }
}

function writeStored(entries: JournalEntry[]): boolean {
  const storage = getStorage()
  if (!storage) return false
  try {
    if (entries.length === 0) storage.removeItem(JOURNAL_KEY)
    else storage.setItem(JOURNAL_KEY, JSON.stringify(entries))
    return true
  } catch {
    return false
  }
}

function makeId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  } catch {
    /* fall through */
  }
  return `j-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export const useJournal = create<JournalState>(() => readStored())

function commit(entries: JournalEntry[]) {
  const persistent = writeStored(entries)
  useJournal.setState({ entries, persistent })
}

/** All entries, newest first. */
export function list(): JournalEntry[] {
  return useJournal.getState().entries
}

/** Adds an entry. Empty (whitespace-only) text is ignored and returns null. */
export function add(text: string, prompt: string = DEFAULT_PROMPT): JournalEntry | null {
  const clean = text.trim().slice(0, MAX_TEXT_LENGTH)
  if (!clean) return null
  const entry: JournalEntry = { id: makeId(), createdAt: new Date().toISOString(), text: clean, prompt }
  commit([entry, ...list()])
  return entry
}

export function remove(id: string): void {
  const entries = list()
  const next = entries.filter((e) => e.id !== id)
  if (next.length !== entries.length) commit(next)
}

export function clear(): void {
  commit([])
}

/** Subscribe to changes; returns an unsubscribe function. */
export function subscribe(cb: (entries: JournalEntry[]) => void): () => void {
  return useJournal.subscribe((s, prev) => {
    if (s.entries !== prev.entries) cb(s.entries)
  })
}

export const journal = { list, add, remove, clear, subscribe }

// Keep several open tabs in sync.
if (typeof window !== 'undefined') {
  try {
    window.addEventListener('storage', (e) => {
      if (e.key === JOURNAL_KEY || e.key === null) useJournal.setState(readStored())
    })
  } catch {
    /* ignore */
  }
}
