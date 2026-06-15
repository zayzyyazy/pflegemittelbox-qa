import type { TranscriptSegment } from '../types/CallReview';
import type { EvidenceMoment } from '../types/EvidenceMoment';

function norm(s: string) {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

export function evidenceMatchesSegment(evidence: EvidenceMoment, segment: TranscriptSegment): boolean {
  const quote = norm(evidence.quote_or_transcript_excerpt || '');
  const text = norm(segment.text || '');
  if (!quote || !text) return false;

  if (quote.length >= 12 && (text.includes(quote.slice(0, Math.min(quote.length, 80))) || quote.includes(text.slice(0, 80)))) {
    return true;
  }

  const start = evidence.timestamp_start_seconds;
  if (start != null && Number.isFinite(start)) {
    const segStart = segment.start ?? 0;
    const segEnd = segment.end ?? segStart + 1;
    if (start >= segStart - 2 && start <= segEnd + 2) return true;
  }

  const words = quote.split(' ').filter(w => w.length > 4);
  if (words.length >= 3) {
    const hit = words.filter(w => text.includes(w)).length;
    if (hit / words.length >= 0.6) return true;
  }
  return false;
}

export function evidenceBySegment(segment: TranscriptSegment, evidence: EvidenceMoment[]) {
  return evidence.filter(e => evidenceMatchesSegment(e, segment));
}

export function segmentsForEvidence(evidence: EvidenceMoment, segments: TranscriptSegment[]) {
  return segments.filter(s => evidenceMatchesSegment(evidence, s));
}

function overlapWords(a: string, b: string) {
  const aw = new Set(norm(a).split(' ').filter(w => w.length > 3));
  const bw = norm(b).split(' ').filter(w => w.length > 3);
  if (!aw.size || !bw.length) return 0;
  const hits = bw.filter(w => aw.has(w)).length;
  return hits / Math.max(aw.size, bw.length);
}

function closestSegmentByTime(start: number | undefined, segments: TranscriptSegment[]) {
  if (start == null || !Number.isFinite(start)) return undefined;
  return [...segments].sort((a, b) => {
    const da = Math.min(Math.abs(start - a.start), Math.abs(start - a.end));
    const db = Math.min(Math.abs(start - b.start), Math.abs(start - b.end));
    return da - db;
  })[0];
}

function bestSegmentByQuote(quote: string, segments: TranscriptSegment[]) {
  if (!quote.trim()) return undefined;
  return [...segments]
    .map(segment => ({ segment, score: overlapWords(segment.text, quote) }))
    .filter(row => row.score >= 0.28)
    .sort((a, b) => b.score - a.score)[0]?.segment;
}

export function groundEvidenceToSegments<T extends Partial<EvidenceMoment>>(
  evidence: T,
  segments?: TranscriptSegment[]
): T {
  if (!segments?.length) return evidence;
  const direct = segments.filter(segment => evidenceMatchesSegment(evidence as EvidenceMoment, segment));
  const fallback =
    direct.length ? undefined :
      bestSegmentByQuote(String(evidence.quote_or_transcript_excerpt || ''), segments) ||
      closestSegmentByTime(evidence.timestamp_start_seconds, segments);
  const matched = direct.length ? direct : fallback ? [fallback] : [];
  if (!matched.length) return evidence;

  const start = matched[0].start;
  const end = matched[matched.length - 1].end;
  const quote = evidence.quote_or_transcript_excerpt?.trim() || matched.map(s => s.text).join(' ').slice(0, 280);
  const speaker =
    evidence.speaker && evidence.speaker !== 'unknown'
      ? evidence.speaker
      : matched.find(s => s.speaker === 'caller' || s.speaker === 'agent')?.speaker || evidence.speaker;

  return {
    ...evidence,
    timestamp_start_seconds: evidence.timestamp_start_seconds || start,
    timestamp_end_seconds: evidence.timestamp_end_seconds || end,
    segment_starts: evidence.segment_starts?.length ? evidence.segment_starts : matched.map(s => s.start),
    quote_or_transcript_excerpt: quote,
    speaker
  };
}
