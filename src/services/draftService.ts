import type { Database } from './storageService';
import type { DraftCall } from '../types/DraftCall';
import type { CallReview } from '../types/CallReview';
import type { EvidenceMoment } from '../types/EvidenceMoment';
import { nowIso } from '../utils/dates';
import { id } from '../utils/text';
import { resolveEvidenceForSave } from '../utils/evidenceReview';
import { upsertCall } from './callsService';
import { replaceEvidenceForCall } from './evidenceService';
import { finalizeDatabaseState } from './issuePatternService';

export function upsertDraft(db: Database, draft: Partial<DraftCall>): Database {
  const now = nowIso();
  const full: DraftCall = {
    status: 'queued',
    file_name: 'recording',
    call: {},
    evidence: [],
    created_at: now,
    ...draft,
    id: draft.id || id('draft'),
    updated_at: now
  };
  const i = (db.drafts || []).findIndex(d => d.id === full.id);
  const drafts = i >= 0 ? db.drafts!.map(d => (d.id === full.id ? full : d)) : [full, ...(db.drafts || [])];
  return { ...db, drafts };
}

export function removeDraft(db: Database, draftId: string): Database {
  return { ...db, drafts: (db.drafts || []).filter(d => d.id !== draftId) };
}

export function removeFailedDrafts(db: Database): Database {
  return { ...db, drafts: (db.drafts || []).filter(d => d.status !== 'failed') };
}

export function resetFailedDraftsForRetry(db: Database): Database {
  return {
    ...db,
    drafts: (db.drafts || []).map(d =>
      d.status === 'failed' ? { ...d, status: 'queued' as const, error: undefined, processing_step: 'Queued' } : d
    )
  };
}

export function updateDraft(db: Database, draftId: string, patch: Partial<DraftCall>): Database {
  const existing = (db.drafts || []).find(d => d.id === draftId);
  if (!existing) return db;
  return upsertDraft(db, { ...existing, ...patch, id: draftId });
}

export function acceptDraft(
  db: Database,
  draft: DraftCall,
  callPatch?: Partial<CallReview>
): Database {
  const full = {
    ...draft.call,
    ...callPatch,
    reviewer_call_notes: callPatch?.reviewer_call_notes ?? draft.call.reviewer_call_notes
  } as CallReview;
  return saveDraftAsCall(db, { ...draft, call: full }, full, draft.evidence as EvidenceMoment[]);
}

export function acceptAllReadyDrafts(db: Database): Database {
  let next = db;
  for (const draft of (db.drafts || []).filter(d => d.status === 'ready')) {
    next = acceptDraft(next, draft);
  }
  return next;
}

export function saveDraftAsCall(
  db: Database,
  draft: DraftCall,
  callPatch?: Partial<CallReview>,
  evidencePatch?: Partial<EvidenceMoment>[]
): Database {
  const now = nowIso();
  const linked = callPatch?.linked_issue_ids || draft.call.linked_issue_ids || [];
  const call = {
    ...draft.call,
    ...callPatch,
    id: draft.call.id || id('call'),
    import_batch_id: draft.import_batch_id || draft.call.import_batch_id,
    imported_at: draft.call.imported_at || now,
    review_status: linked.length ? 'flagged' : 'reviewed',
    updated_at: now,
    created_at: draft.call.created_at || now,
    needs_review: false
  } as CallReview;

  const evidence = resolveEvidenceForSave(evidencePatch || draft.evidence).map(e => ({
    ...e,
    call_id: call.id,
    id: e.id || id('ev')
  })) as EvidenceMoment[];

  let next = upsertCall(db, call);
  if (evidence.length) next = replaceEvidenceForCall(next, call.id, evidence);
  next = finalizeDatabaseState(next);
  return removeDraft(next, draft.id);
}
