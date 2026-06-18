import type { CallReview, TranscriptSegment } from '../types/CallReview';

function asObj(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** Pull spoken lines from Leaping event payloads when stored transcript fields are empty. */
export function segmentsFromLeapingEvents(events?: unknown[]): TranscriptSegment[] {
  if (!Array.isArray(events)) return [];
  let seq = 0;
  const out: TranscriptSegment[] = [];
  for (const item of events) {
    const e = asObj(item);
    const type = String(e.type || '');
    if (type !== 'message' && type !== 'chat_message') continue;
    const sender = String(e.sender || e.speaker || e.role || '').toLowerCase();
    const text = String(e.text || e.message || e.content || '').trim();
    if (!text) continue;
    const start =
      typeof e.start === 'number' ? e.start :
      typeof e.start_seconds === 'number' ? e.start_seconds :
      typeof e.time === 'number' ? e.time :
      seq;
    seq = start + 1;
    out.push({
      start,
      end: start + 1,
      text,
      speaker:
        sender.includes('bot') || sender.includes('agent') || sender.includes('marie')
          ? 'agent'
          : sender.includes('human') || sender.includes('caller') || sender.includes('user')
            ? 'caller'
            : 'unknown'
    });
  }
  return out;
}

export function buildTranscriptSegments(call: Partial<CallReview>, draftTranscript?: string): TranscriptSegment[] {
  if (call.transcript_segments?.length) return call.transcript_segments;
  const fromEvents = segmentsFromLeapingEvents(call.leaping_transcript_events);
  if (fromEvents.length) return fromEvents;
  const text = call.transcript || draftTranscript || '';
  if (!text.trim()) return [];
  return text.split('\n').filter(Boolean).map((line, i) => {
    const callerMatch = /^caller:\s*/i.test(line);
    const agentMatch = /^agent:\s*/i.test(line) || /^marie:\s*/i.test(line);
    return {
      start: i,
      end: i + 1,
      text: line.replace(/^(caller|agent|marie):\s*/i, '').trim() || line,
      speaker: callerMatch ? 'caller' : agentMatch ? 'agent' : 'unknown'
    };
  });
}
