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
