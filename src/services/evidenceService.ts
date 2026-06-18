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

export const replaceEvidenceForCall = (db: Database, callId: string, moments: EvidenceMoment[]) => {
  const preserved = db.evidence.filter(e => e.call_id === callId && e.source === 'system_rule');
  const merged = [...preserved, ...moments.filter(m => m.source !== 'system_rule')];
  const byKey = new Map<string, EvidenceMoment>();
  for (const ev of merged) {
    const key = `${ev.source}:${ev.moment_type}:${ev.explanation?.slice(0, 80)}`;
    if (!byKey.has(key)) byKey.set(key, ev);
  }
  return finalizeDatabaseState({
    ...db,
    evidence: [...db.evidence.filter(e => e.call_id !== callId), ...byKey.values()]
  });
};

export const deleteEvidence = (db: Database, evidenceId: string) => ({
  ...db,
  evidence: db.evidence.filter(e => e.id !== evidenceId)
});

export const evidenceByCall = (db: Database, callId: string) => db.evidence.filter(e => e.call_id === callId);

export const evidenceByIssue = (db: Database, issueId: string) => db.evidence.filter(e => e.issue_id === issueId);
