import type { AcousticEvent } from '../types/AudioAnalysis';

const FRAME_MS = 50;
const SILENCE_RMS = 0.012;
const GAP_MIN_MS = 5000;
const MERGE_GAP_MS = 8000;
const MAX_ACOUSTIC_EVENTS = 3;

/** Decode audio file duration in seconds. */
export async function decodeAudioDuration(file: File): Promise<number> {
  const ctx = new AudioContext();
  try {
    const decoded = await ctx.decodeAudioData(await file.arrayBuffer());
    return decoded.duration;
  } finally {
    await ctx.close().catch(() => undefined);
  }
}

function mergeNearbyGaps(events: AcousticEvent[]): AcousticEvent[] {
  if (!events.length) return [];
  const sorted = [...events].sort((a, b) => a.start_ms - b.start_ms);
  const merged: AcousticEvent[] = [];
  for (const event of sorted) {
    const last = merged[merged.length - 1];
    if (last && event.start_ms - last.end_ms < MERGE_GAP_MS) {
      const gapMs = Math.max(last.end_ms, event.end_ms) - Math.min(last.start_ms, event.start_ms);
      if (gapMs >= GAP_MIN_MS) {
        merged[merged.length - 1] = {
          type: 'silence_gap',
          start_ms: Math.min(last.start_ms, event.start_ms),
          end_ms: Math.max(last.end_ms, event.end_ms),
          severity: gapMs >= 8000 ? 'high' : 'medium',
          description: `Dead air ~${(gapMs / 1000).toFixed(1)}s at ${formatClock(Math.min(last.start_ms, event.start_ms) / 1000)}`
        };
      }
      continue;
    }
    merged.push(event);
  }
  return merged;
}

/** Decode audio and detect silence gaps via Web Audio RMS frames. */
export async function analyzeAudioAcoustics(file: File): Promise<AcousticEvent[]> {
  const ctx = new AudioContext();
  try {
    const buffer = await file.arrayBuffer();
    const decoded = await ctx.decodeAudioData(buffer.slice(0));
    const channel = decoded.getChannelData(0);
    const sampleRate = decoded.sampleRate;
    const frameSamples = Math.max(1, Math.floor((sampleRate * FRAME_MS) / 1000));
    const raw: AcousticEvent[] = [];

    let gapStartMs: number | null = null;
    for (let i = 0; i < channel.length; i += frameSamples) {
      const end = Math.min(i + frameSamples, channel.length);
      let sum = 0;
      for (let j = i; j < end; j++) sum += channel[j] * channel[j];
      const rms = Math.sqrt(sum / Math.max(1, end - i));
      const tMs = Math.round((i / sampleRate) * 1000);
      const speaking = rms >= SILENCE_RMS;

      if (!speaking && gapStartMs == null) gapStartMs = tMs;
      if (speaking && gapStartMs != null) {
        const gapMs = tMs - gapStartMs;
        if (gapMs >= GAP_MIN_MS) {
          raw.push({
            type: 'silence_gap',
            start_ms: gapStartMs,
            end_ms: tMs,
            severity: gapMs >= 8000 ? 'high' : 'medium',
            description: `Dead air ~${(gapMs / 1000).toFixed(1)}s at ${formatClock(gapStartMs / 1000)}`
          });
        }
        gapStartMs = null;
      }
    }

    return mergeNearbyGaps(raw)
      .sort((a, b) => b.end_ms - b.start_ms - (a.end_ms - a.start_ms))
      .slice(0, MAX_ACOUSTIC_EVENTS);
  } finally {
    await ctx.close().catch(() => undefined);
  }
}

function formatClock(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
