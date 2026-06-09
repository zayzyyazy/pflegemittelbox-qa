import type { CallReview } from '../types/CallReview';
import type { EvidenceMoment } from '../types/EvidenceMoment';
import type { AcousticEvent, TimingSignal } from '../types/AudioAnalysis';

const FRICTION_CUES = ['however', 'aber', 'confusion', 'verwirr', 'wiederhol', 'pause', 'problem', 'frust'];

export function formatFriction(call: Partial<CallReview>, evidence: EvidenceMoment[] = []): string {
  if (call.primary_friction?.trim()) return call.primary_friction.trim();

  const audioHeard = evidence
    .filter(e => e.source === 'audio_listener' && e.voice_cue_notes?.trim())
    .map(e => e.voice_cue_notes!.trim());
  if (audioHeard.length) return audioHeard[0].slice(0, 120);

  const topEvidence = evidence.find(e => e.explanation?.trim() || e.quote_or_transcript_excerpt?.trim());
  if (topEvidence) {
    return (topEvidence.explanation || topEvidence.quote_or_transcript_excerpt).slice(0, 120);
  }

  if (call.primary_issue_label && call.primary_issue_label !== 'No major issue') {
    return call.primary_issue_label;
  }

  if (call.caller_cut_off) return 'Caller interrupted / cut off';
  if (call.awkward_pauses) return 'Long pause / dead air';
  if (call.identification_problem) return 'Repeated authentication';
  if (call.repeated_question) return 'Repeated question';
  if (call.missing_integration) return 'Missing integration';
  if (call.robotic_pacing) return 'Robotic pacing';
  if (call.root_cause_category && call.root_cause_category !== 'Other') return call.root_cause_category;

  const firstBreakpoint = call.breakpoint_notes
    ?.split(/\n+/)
    .map(line => line.trim())
    .find(Boolean);
  if (firstBreakpoint) return firstBreakpoint.slice(0, 120);

  if (call.solved_status === 'partially') return 'Partially resolved';
  if (call.solved_status === 'no') return 'Unresolved';
  if (call.solved_status === 'yes') {
    const summary = call.call_summary?.toLowerCase() || '';
    if (FRICTION_CUES.some(cue => summary.includes(cue))) {
      return call.call_summary!.slice(0, 120);
    }
    return 'Resolved cleanly';
  }
  return 'Unspecified';
}

export function buildPrimaryFriction(
  call: Partial<CallReview>,
  evidence: EvidenceMoment[],
  acoustic: AcousticEvent[] = []
): string | undefined {
  const formatted = formatFriction(call, evidence);
  if (formatted && formatted !== 'Unspecified' && formatted !== 'Resolved cleanly') return formatted;
  const gaps = acoustic.filter(e => e.type === 'silence_gap');
  if (gaps.length > 1) return 'Multiple pauses detected during call';
  const gap = gaps.find(e => e.severity !== 'low');
  if (gap) return gap.description.slice(0, 120);
  return formatted === 'Resolved cleanly' ? formatted : undefined;
}
