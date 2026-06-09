import type { TranscriptSegment } from '../types/CallReview';

/** Lines before/after a selection for AI investigation context. */
export function getTranscriptWindow(
  segments: TranscriptSegment[],
  startIndex: number,
  endIndex: number,
  radius = 5
): TranscriptSegment[] {
  if (!segments.length) return [];
  const lo = Math.max(0, Math.min(startIndex, endIndex) - radius);
  const hi = Math.min(segments.length - 1, Math.max(startIndex, endIndex) + radius);
  return segments.slice(lo, hi + 1);
}

export function formatTranscriptWindow(segments: TranscriptSegment[]): string {
  return segments
    .map(s => `[${formatTime(s.start)}] ${s.speaker ? `${s.speaker}: ` : ''}${s.text}`)
    .join('\n');
}

function formatTime(sec: number) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function mergeSegmentSelection(segments: TranscriptSegment[], indices: number[]) {
  const sorted = [...indices].sort((a, b) => a - b);
  const picked = sorted.map(i => segments[i]).filter(Boolean);
  if (!picked.length) {
    return { start: 0, end: 0, text: '', speaker: 'unknown' as const, indices: sorted };
  }
  const text = picked.map(s => s.text).join(' ').trim();
  const speaker =
    picked.filter(s => s.speaker === 'caller').length >= picked.filter(s => s.speaker === 'agent').length
      ? 'caller'
      : picked.some(s => s.speaker === 'agent')
        ? 'agent'
        : 'unknown';
  return {
    start: picked[0].start,
    end: picked[picked.length - 1].end,
    text,
    speaker: speaker as 'caller' | 'agent' | 'unknown',
    indices: sorted
  };
}
