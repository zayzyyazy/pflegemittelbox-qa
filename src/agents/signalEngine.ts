import type { TranscriptSegment } from '../types/CallReview';
import type { TimingSignal } from '../types/AudioAnalysis';

/** Timing signals from Whisper segment structure (gaps, repeated prompts). */
export function detectTimingSignalsFromSegments(segments?: TranscriptSegment[]): TimingSignal[] {
  if (!segments?.length) return [];
  const signals: TimingSignal[] = [];

  for (let i = 1; i < segments.length; i++) {
    const prev = segments[i - 1];
    const cur = segments[i];
    const gapSec = Math.max(0, cur.start - prev.end);
    if (gapSec >= 3) {
      signals.push({
        kind: 'long_turn_gap',
        start_ms: Math.round(prev.end * 1000),
        end_ms: Math.round(cur.start * 1000),
        description: `${gapSec.toFixed(1)}s gap between turns before "${cur.text.slice(0, 40)}"`
      });
    }
    if (
      prev.text.trim().toLowerCase() === cur.text.trim().toLowerCase() &&
      cur.text.trim().length > 8
    ) {
      signals.push({
        kind: 'rapid_repeated_prompt',
        start_ms: Math.round(cur.start * 1000),
        end_ms: Math.round(cur.end * 1000),
        description: `Repeated prompt: "${cur.text.slice(0, 60)}"`
      });
    }
  }

  return signals.slice(0, 8);
}
