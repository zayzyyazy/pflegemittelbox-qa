import type { WorkspaceNote } from '../types/WorkspaceNote';

export const NOTES_KEY = 'pflegemittelbox-qa-notes-v1';
export const NOTE_IMAGES_KEY = 'pflegemittelbox-qa-note-images-v1';
const DB_KEY = 'pflegemittelbox-qa-db-v1';
const LEGACY_KEY = 'ai-call-qa-cockpit-db-v1';

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  localStorage.setItem(key, JSON.stringify(value));
}

export function loadPersistedNotes(): WorkspaceNote[] {
  const notes = readJson<WorkspaceNote[]>(NOTES_KEY, []);
  const images = readJson<Record<string, string>>(NOTE_IMAGES_KEY, {});
  return notes.map(note => ({
    ...note,
    image_data_url: note.image_data_url?.startsWith('ref:')
      ? images[note.id] || undefined
      : note.image_data_url || images[note.id]
  }));
}

export function savePersistedNotes(notes: WorkspaceNote[]): boolean {
  try {
    const slim = notes.map(note => ({
      ...note,
      image_data_url: note.image_data_url && !note.image_data_url.startsWith('ref:') ? `ref:${note.id}` : note.image_data_url
    }));
    writeJson(NOTES_KEY, slim);

    const pendingImages = notes.filter(n => n.image_data_url && n.id && !n.image_data_url.startsWith('ref:'));
    if (pendingImages.length) {
      const images = readJson<Record<string, string>>(NOTE_IMAGES_KEY, {});
      for (const note of pendingImages) {
        if (note.id && note.image_data_url) images[note.id] = note.image_data_url;
      }
      writeJson(NOTE_IMAGES_KEY, images);
    }
    return true;
  } catch (e) {
    console.error('[notes] save failed', e);
    return false;
  }
}

function personalToWorkspace(
  item: { id: string; text: string; created_at: string; updated_at: string }
): WorkspaceNote {
  return {
    id: `personal:${item.id}`,
    kind: 'general',
    title: 'Personal note',
    note: item.text,
    tags: ['personal', 'recovered'],
    created_at: item.created_at,
    updated_at: item.updated_at
  };
}

/** Scan main DB blobs for notes that never made it to the dedicated notes key. */
export function recoverArchivedNotes(): WorkspaceNote[] {
  const byId = new Map(loadPersistedNotes().map(n => [n.id, n]));

  for (const key of [DB_KEY, LEGACY_KEY]) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as {
        workspaceNotes?: WorkspaceNote[];
        personalNotes?: Array<{ id: string; text: string; created_at: string; updated_at: string }>;
      };
      for (const note of parsed.workspaceNotes || []) {
        if (note?.id && note.note?.trim()) byId.set(note.id, note);
      }
      for (const note of parsed.personalNotes || []) {
        if (note?.text?.trim()) {
          const mapped = personalToWorkspace(note);
          byId.set(mapped.id, mapped);
        }
      }
    } catch {
      // partial / corrupt db — skip
    }
  }

  return [...byId.values()].sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
}

export function hydrateNotesFromMainDb(mainNotes: WorkspaceNote[] | undefined): WorkspaceNote[] {
  const recovered = recoverArchivedNotes();
  if (!mainNotes?.length) return recovered;
  const byId = new Map(recovered.map(n => [n.id, n]));
  for (const note of mainNotes) {
    if (note?.id) byId.set(note.id, note);
  }
  const merged = [...byId.values()].sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
  savePersistedNotes(merged);
  return merged;
}
