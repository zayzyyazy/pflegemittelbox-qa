import type { Database } from './storageService';
import type { CallReview } from '../types/CallReview';
import { deleteStoredAudio } from './audioStorageService';
import { finalizeDatabaseState } from './issuePatternService';
import { nowIso } from '../utils/dates';
import { id } from '../utils/text';

export const upsertCall = (db: Database, call: Partial<CallReview>) => {
  const now = nowIso();
  const full = {
    ...call,
    id: call.id || id('call'),
    created_at: call.created_at || now,
    updated_at: now
  } as CallReview;
  const i = db.calls.findIndex(c => c.id === full.id);
  const calls = i >= 0 ? db.calls.map(c => (c.id === full.id ? full : c)) : [full, ...db.calls];
  return finalizeDatabaseState({ ...db, calls });
};

export const deleteCall = (db: Database, callId: string) =>
  finalizeDatabaseState({
    ...db,
    calls: db.calls.filter(c => c.id !== callId),
    evidence: db.evidence.filter(e => e.call_id !== callId)
  });

export async function deleteCallWithAudio(db: Database, callId: string): Promise<Database> {
  const call = db.calls.find(c => c.id === callId);
  if (call) await deleteStoredAudio(call);
  return deleteCall(db, callId);
}