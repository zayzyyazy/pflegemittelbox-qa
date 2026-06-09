import type { CallReview } from '../types/CallReview';
import type { Database } from './storageService';
import { nowIso } from '../utils/dates';
import { upsertCall } from './callsService';

export function patchCall(db: Database, callId: string, patch: Partial<CallReview>): Database {
  const call = db.calls.find(c => c.id === callId);
  if (!call) return db;
  return upsertCall(db, { ...call, ...patch, updated_at: nowIso() });
}

export function toggleCallFlag(
  db: Database,
  callId: string,
  key: keyof Pick<
    CallReview,
    | 'pinned'
    | 'critical'
    | 'watch_later'
    | 'needs_review'
    | 'investigation_starred'
    | 'training_example'
    | 'engineering_escalated'
  >
): Database {
  const call = db.calls.find(c => c.id === callId);
  if (!call) return db;
  return patchCall(db, callId, { [key]: !call[key] });
}
