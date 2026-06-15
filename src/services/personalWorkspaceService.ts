import type { Database } from './storageService';
import type { PersonalTask } from '../types/PersonalTask';
import { nowIso } from '../utils/dates';
import { id } from '../utils/text';

function inferPriority(text: string): PersonalTask['priority'] {
  if (/\b(urgent|high|sofort|wichtig|kritisch|blocker)\b/i.test(text)) return 'high';
  if (/\b(check|review|look into|prüf|anschauen|klären|fix)\b/i.test(text)) return 'medium';
  return 'low';
}

function inferDueHint(text: string): string | undefined {
  if (/\btoday|heute\b/i.test(text)) return 'today';
  if (/\bthis week|diese woche|week\b/i.test(text)) return 'this week';
  if (/\btomorrow|morgen\b/i.test(text)) return 'tomorrow';
  return undefined;
}

function inferTags(text: string): string[] {
  const tags = new Set<string>();
  if (/pg\s?54|pg54/i.test(text)) tags.add('PG54');
  if (/cancell?ation|kündigung|kuendigung|cancel/i.test(text)) tags.add('cancellation');
  if (/liefer|delivery|status|tracking/i.test(text)) tags.add('delivery');
  if (/auth|geburtsdatum|versicherungsnummer|verification/i.test(text)) tags.add('authentication');
  if (/pause|paus/i.test(text)) tags.add('pause');
  if (/objection|retention|einwand/i.test(text)) tags.add('objection handling');
  return [...tags];
}

export function createPersonalTask(text: string): PersonalTask {
  const now = nowIso();
  const clean = text.trim();
  return {
    id: id('task'),
    text: clean,
    normalized_title: clean.length > 80 ? `${clean.slice(0, 77).trim()}...` : clean,
    priority: inferPriority(clean),
    status: 'open',
    topic_tags: inferTags(clean),
    due_hint: inferDueHint(clean),
    source: 'llm_assisted',
    created_at: now,
    updated_at: now
  };
}

export function addPersonalTask(db: Database, text: string): Database {
  if (!text.trim()) return db;
  return { ...db, personalTasks: [createPersonalTask(text), ...(db.personalTasks || [])] };
}

export function updatePersonalTask(db: Database, taskId: string, patch: Partial<PersonalTask>): Database {
  const now = nowIso();
  return {
    ...db,
    personalTasks: (db.personalTasks || []).map(task =>
      task.id === taskId ? { ...task, ...patch, updated_at: now } : task
    )
  };
}

export function addPersonalNote(db: Database, note: string): Database {
  if (!note.trim()) return db;
  const now = nowIso();
  return {
    ...db,
    personalNotes: [
      { id: id('note'), text: note.trim(), created_at: now, updated_at: now },
      ...(db.personalNotes || [])
    ]
  };
}
