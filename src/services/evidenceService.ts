import type { Database } from './storageService';
import type { EvidenceMoment } from '../types/EvidenceMoment';
import { finalizeDatabaseState } from './issuePatternService';
import { nowIso } from '../utils/dates';
import { id } from '../utils/text';

export const upsertEvidence = (db: Database, ev: Partial<EvidenceMoment>) => {
  const now = nowIso();
  const full = { ...ev, id: ev.id || id('ev'), created_at: ev.created_at || now, updated_at: now } as EvidenceMoment;
  const evidence = db.evidence.some(e => e.id === full.id)
    ? db.evidence.map(e => (e.id === full.id ? full : e))
    : [full, ...db.evidence];
  return finalizeDatabaseState({ ...db, evidence });
};

export const replaceEvidenceForCall = (db: Database, callId: string, moments: EvidenceMoment[]) =>
  finalizeDatabaseState({
    ...db,
    evidence: [...db.evidence.filter(e => e.call_id !== callId), ...moments]
  });

export const deleteEvidence = (db: Database, evidenceId: string) => ({
  ...db,
  evidence: db.evidence.filter(e => e.id !== evidenceId)
});

export const evidenceByCall = (db: Database, callId: string) => db.evidence.filter(e => e.call_id === callId);

export const evidenceByIssue = (db: Database, issueId: string) => db.evidence.filter(e => e.issue_id === issueId);
