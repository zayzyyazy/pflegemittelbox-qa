import type { AudioClipWindow } from '../types/AudioAnalysis';
import type { AcousticEvent } from '../types/AudioAnalysis';
import type { TimingSignal } from '../types/AudioAnalysis';

function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const numChannels = 1;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const buffer = new ArrayBuffer(44 + samples.length * bytesPerSample);
  const view = new DataView(buffer);
  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * bytesPerSample, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bytesPerSample * 8, true);
  writeStr(36, 'data');
  view.setUint32(40, samples.length * bytesPerSample, true);
  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

async function decodeMono(file: File): Promise<{ samples: Float32Array; sampleRate: number }> {
  const ctx = new AudioContext();
  try {
    const decoded = await ctx.decodeAudioData(await file.arrayBuffer());
    return { samples: decoded.getChannelData(0), sampleRate: decoded.sampleRate };
  } finally {
    await ctx.close().catch(() => undefined);
  }
}

/** Extract a wav clip from stored audio for API upload. */
export async function extractAudioClip(
  file: File,
  startSeconds: number,
  endSeconds: number
): Promise<File> {
  const { samples, sampleRate } = await decodeMono(file);
  const start = Math.max(0, Math.floor(startSeconds * sampleRate));
  const end = Math.min(samples.length, Math.ceil(endSeconds * sampleRate));
  if (end <= start) {
    throw new Error('Invalid clip window');
  }
  const slice = samples.slice(start, end);
  const blob = encodeWav(slice, sampleRate);
  const base = file.name.replace(/\.[^.]+$/, '') || 'clip';
  return new File([blob], `${base}-${Math.round(startSeconds)}s.wav`, { type: 'audio/wav' });
}

function clipWindow(
  startSeconds: number,
  endSeconds: number,
  maxClipSeconds: number,
  reason: string
): AudioClipWindow {
  const end = Math.min(endSeconds, startSeconds + maxClipSeconds);
  return { start_seconds: Math.max(0, startSeconds), end_seconds: end, reason };
}

export function selectClipWindows(
  durationSeconds: number,
  acoustic: AcousticEvent[],
  timing: TimingSignal[],
  maxClips: number,
  maxClipSeconds: number
): AudioClipWindow[] {
  const dur = durationSeconds > 0 ? durationSeconds : maxClipSeconds;
  const windows: AudioClipWindow[] = [];

  windows.push(
    clipWindow(0, Math.min(maxClipSeconds, dur), maxClipSeconds, 'Call opening')
  );

  const longestGap = [...acoustic].sort(
    (a, b) => b.end_ms - b.start_ms - (a.end_ms - a.start_ms)
  )[0];
  if (longestGap) {
    const pad = Math.min(8, maxClipSeconds / 3);
    const start = Math.max(0, longestGap.start_ms / 1000 - pad);
    const end = Math.min(dur, longestGap.end_ms / 1000 + pad);
    windows.push(clipWindow(start, end, maxClipSeconds, longestGap.description));
  }

  for (const signal of timing) {
    const pad = Math.min(8, maxClipSeconds / 3);
    const start = Math.max(0, signal.start_ms / 1000 - pad);
    const end = Math.min(dur, signal.end_ms / 1000 + pad);
    windows.push(clipWindow(start, end, maxClipSeconds, signal.description));
  }

  if (dur > maxClipSeconds) {
    const tailStart = Math.max(0, dur - maxClipSeconds);
    windows.push(clipWindow(tailStart, dur, maxClipSeconds, 'Call ending'));
  }

  const merged = dedupeWindows(windows, maxClipSeconds);
  const selected = merged.slice(0, maxClips);
  if (selected.length) return selected;

  return [clipWindow(0, Math.min(maxClipSeconds, dur), maxClipSeconds, 'Fallback opening clip')];
}

function dedupeWindows(windows: AudioClipWindow[], maxClipSeconds: number): AudioClipWindow[] {
  const sorted = [...windows].sort((a, b) => a.start_seconds - b.start_seconds);
  const out: AudioClipWindow[] = [];
  for (const w of sorted) {
    if (out.some(o => Math.abs(o.start_seconds - w.start_seconds) < 5)) continue;
    out.push({
      ...w,
      end_seconds: Math.min(w.end_seconds, w.start_seconds + maxClipSeconds)
    });
  }
  return out;
}

export async function fileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export function audioFormatForFile(file: File): 'wav' | 'mp3' {
  const name = file.name.toLowerCase();
  if (name.endsWith('.mp3')) return 'mp3';
  return 'wav';
}
