import type { CallReview, TranscriptSegment } from '../types/CallReview';
import type { Settings } from '../services/storageService';
import type { AcousticEvent, TimingSignal } from '../types/AudioAnalysis';

const FRICTION_CUES = ['however', 'aber', 'confusion', 'verwirr', 'wiederhol', 'pause', 'problem', 'frust'];

export function shouldRunAudioListener(
  settings: Settings,
  call: Partial<CallReview>,
  transcript: string,
  acoustic: AcousticEvent[],
  timing: TimingSignal[],
  durationSeconds?: number
): boolean {
  if (!settings.audioListenerEnabled) return false;
  if (!settings.openaiApiKey.trim()) return false;

  const dur = durationSeconds || call.duration_seconds || 0;
  if (dur > 0 && dur <= (settings.alwaysListenFullCallUnderSeconds ?? 180)) return true;

  if (acoustic.some(e => e.severity !== 'low')) return true;
  if (timing.length > 0) return true;

  if (call.caller_cut_off || call.awkward_pauses || call.identification_problem || call.repeated_question) {
    return true;
  }

  const lower = transcript.toLowerCase();
  if (/geburt|versicher|vnr|noch mal|wiederhol|moment|hallo\?|hören sie/.test(lower)) return true;
  if (call.solved_status === 'yes' && FRICTION_CUES.some(c => lower.includes(c))) return true;

  return false;
}

export function acousticNotes(acoustic: AcousticEvent[], timing: TimingSignal[]): string[] {
  return [
    ...acoustic.map(e => e.description),
    ...timing.map(t => t.description)
  ].slice(0, 6);
}

export function transcriptSignals(transcript: string, segments?: TranscriptSegment[]): string[] {
  const notes: string[] = [];
  const lower = transcript.toLowerCase();
  if (/bitte nennen sie ihr geburtsdatum/.test(lower)) {
    const agentDobPrompts = (lower.match(/agent:[^.\n]*geburtsdatum/g) || []).length;
    if (agentDobPrompts >= 2) notes.push('Repeated date-of-birth authentication prompts in transcript');
  }
  if (/einen moment|bitte warten/.test(lower) && lower.split('einen moment').length > 2) {
    notes.push('Multiple hold/wait phrases');
  }
  if (segments?.some((s, i) => i > 0 && s.text.trim() === segments[i - 1].text.trim())) {
    notes.push('Duplicate consecutive transcript segments');
  }
  return notes;
}
