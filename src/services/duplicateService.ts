import type { CallReview } from '../types/CallReview'; import { similarity } from '../utils/text';
export interface DuplicateMatch { call: CallReview; reason: string; score: number; }
export function findDuplicate(call: Partial<CallReview>, calls: CallReview[]): DuplicateMatch | null {
 for (const c of calls) {
  if (call.call_id && c.call_id === call.call_id) return { call:c, reason:'Exact call ID match', score:1 };
  if (call.audio_file_name && c.audio_file_name === call.audio_file_name && c.audio_file_size === call.audio_file_size) return { call:c, reason:'Same audio filename and size', score:.95 };
  if (call.transcript && similarity(call.transcript, c.transcript) > .72) return { call:c, reason:'Similar transcript', score:.8 };
  if (call.call_summary && c.date === call.date && Math.abs((c.duration_seconds||0)-(call.duration_seconds||0)) < 8 && similarity(call.call_summary, c.call_summary) > .65) return { call:c, reason:'Similar summary/date/duration', score:.7 };
 }
 return null;
}