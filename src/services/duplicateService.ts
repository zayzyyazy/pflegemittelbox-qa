import type { CallReview } from '../types/CallReview';
import { similarity } from '../utils/text';

export interface DuplicateMatch {
  call: CallReview;
  reason: string;
  score: number;
}

export function findDuplicate(
  call: Partial<CallReview>,
  calls: CallReview[],
  excludeId?: string
): DuplicateMatch | null {
  const pool = excludeId ? calls.filter(c => c.id !== excludeId) : calls;
  for (const c of pool) {
    if (call.call_id && c.call_id === call.call_id) {
      return { call: c, reason: 'Exact call ID match', score: 1 };
    }
    if (
      call.audio_file_name &&
      c.audio_file_name === call.audio_file_name &&
      c.audio_file_size === call.audio_file_size
    ) {
      return { call: c, reason: 'Same audio filename and size', score: 0.95 };
    }
    if (call.transcript && similarity(call.transcript, c.transcript) > 0.72) {
      return { call: c, reason: 'Similar transcript', score: 0.8 };
    }
    if (
      call.call_summary &&
      c.date === call.date &&
      Math.abs((c.duration_seconds || 0) - (call.duration_seconds || 0)) < 8 &&
      similarity(call.call_summary, c.call_summary) > 0.65
    ) {
      return { call: c, reason: 'Similar summary/date/duration', score: 0.7 };
    }
  }
  return null;
}

/** Map call id → duplicate match (first matching older/newer call in library). */
export function buildDuplicateIndex(calls: CallReview[]): Map<string, DuplicateMatch> {
  const index = new Map<string, DuplicateMatch>();
  for (let i = 0; i < calls.length; i++) {
    for (let j = i + 1; j < calls.length; j++) {
      const a = calls[i];
      const b = calls[j];
      const matchAb = findDuplicate(a, [b], a.id);
      const matchBa = findDuplicate(b, [a], b.id);
      if (matchAb && !index.has(a.id)) index.set(a.id, matchAb);
      if (matchBa && !index.has(b.id)) index.set(b.id, matchBa);
    }
  }
  return index;
}