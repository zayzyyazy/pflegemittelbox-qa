import type { TranscriptSegment } from '../types/CallReview';

type Obj = Record<string, unknown>;

function asObj(value: unknown): Obj {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Obj : {};
}

function firstString(obj: Obj, keys: string[]): string {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number') return String(value);
  }
  return '';
}

function firstNumber(obj: Obj, keys: string[]): number {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && Number.isFinite(Number(value))) return Number(value);
  }
  return 0;
}

function nested(obj: Obj, paths: string[][]): unknown {
  for (const path of paths) {
    let cur: unknown = obj;
    for (const part of path) cur = asObj(cur)[part];
    if (cur != null && cur !== '') return cur;
  }
  return undefined;
}

/** Read all transcript events from a Leaping payload (no cap — used to build full text). */
export function allLeapingTranscriptEvents(raw: Obj): unknown[] {
  const value = nested(raw, [['transcript'], ['events'], ['messages'], ['call', 'transcript'], ['results', 'transcript']]);
  return Array.isArray(value) ? value : [];
}

/** Persist a trimmed event list — messages + function markers only. */
export function compactLeapingEventsForStorage(events: unknown[], max = 160): unknown[] {
  const priority = events.filter(item => {
    const type = firstString(asObj(item), ['type']);
    return type === 'message' || type === 'chat_message' || type === 'function' ||
      type === 'function_call_request' || type === 'transition' || type === 'field_update';
  });
  return priority.slice(0, max);
}

function speakerFromSender(sender: string): TranscriptSegment['speaker'] {
  const s = sender.toLowerCase();
  if (s.includes('bot') || s.includes('agent') || s.includes('marie') || s.includes('assistant')) return 'agent';
  if (s.includes('human') || s.includes('caller') || s.includes('user') || s.includes('kunde')) return 'caller';
  return 'unknown';
}

/** Build segments from Leaping events with `time` / `seq` timestamps. */
export function segmentsFromLeapingEvents(events: unknown[]): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  let seqIndex = 0;

  for (const item of events) {
    const e = asObj(item);
    const type = firstString(e, ['type']);
    if (type && type !== 'message' && type !== 'chat_message') continue;

    const text = firstString(e, ['text', 'transcript', 'content', 'message']);
    if (!text) continue;

    const start = firstNumber(e, ['time', 'start', 'start_seconds', 'start_time', 'timestamp_seconds', 'timestamp']);
    const end = firstNumber(e, ['end', 'end_seconds', 'end_time']);
    const sender = firstString(e, ['sender', 'speaker', 'role']) || 'unknown';
    const resolvedStart = start > 0 ? start : seqIndex * 2;
    const resolvedEnd = end > resolvedStart ? end : resolvedStart + Math.max(1, Math.min(8, text.split(/\s+/).length * 0.4));

    segments.push({
      start: resolvedStart,
      end: resolvedEnd,
      speaker: speakerFromSender(sender),
      text
    });
    seqIndex += 1;
  }

  return segments;
}

export function transcriptTextFromLeapingEvents(events: unknown[]): string {
  return events
    .map(item => {
      const e = asObj(item);
      const type = firstString(e, ['type']);
      if (type && type !== 'message' && type !== 'chat_message') return '';
      const sender = firstString(e, ['sender', 'speaker', 'role']) || 'unknown';
      const text = firstString(e, ['text', 'transcript', 'content', 'message']);
      if (!text) return '';
      const label = speakerFromSender(sender) === 'agent' ? 'Agent' : speakerFromSender(sender) === 'caller' ? 'Caller' : sender;
      return `${label}: ${text}`;
    })
    .filter(Boolean)
    .join('\n');
}
