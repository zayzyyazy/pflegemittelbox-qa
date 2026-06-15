import type { Database } from './storageService';
import type { WorkspaceNote } from '../types/WorkspaceNote';
import { nowIso } from '../utils/dates';
import { id } from '../utils/text';

export function createWorkspaceNote(input: Omit<WorkspaceNote, 'id' | 'created_at' | 'updated_at'>): WorkspaceNote {
  const now = nowIso();
  return {
    id: id('note'),
    ...input,
    note: input.note.trim(),
    call_id: input.call_id?.trim() || undefined,
    title: input.title?.trim() || undefined,
    pasted_text: input.pasted_text?.trim() || undefined,
    tags: input.tags?.map(t => t.trim()).filter(Boolean),
    created_at: now,
    updated_at: now
  };
}

export function addWorkspaceNote(db: Database, note: Omit<WorkspaceNote, 'id' | 'created_at' | 'updated_at'>): Database {
  if (!note.note.trim() && !note.pasted_text?.trim() && !note.image_data_url) return db;
  return { ...db, workspaceNotes: [createWorkspaceNote(note), ...(db.workspaceNotes || [])] };
}

export function updateWorkspaceNote(db: Database, noteId: string, patch: Partial<WorkspaceNote>): Database {
  const now = nowIso();
  return {
    ...db,
    workspaceNotes: (db.workspaceNotes || []).map(note =>
      note.id === noteId ? { ...note, ...patch, updated_at: now } : note
    )
  };
}

export function deleteWorkspaceNote(db: Database, noteId: string): Database {
  return { ...db, workspaceNotes: (db.workspaceNotes || []).filter(note => note.id !== noteId) };
}
