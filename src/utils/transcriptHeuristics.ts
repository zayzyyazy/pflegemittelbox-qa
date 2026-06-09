import type { TranscriptSegment } from '../types/CallReview';
import type { EvidenceMoment, EvidenceMomentType, EvidenceSpeaker } from '../types/EvidenceMoment';
import {
  detectContextualEvidence,
  type CallUnderstanding
} from '../analysis/callUnderstanding';

const MOMENT_ALIASES: Record<string, EvidenceMomentType> = {
  authentication_friction: 'repeated_authentication',
  repeated_question: 'repeated_authentication',
  wrong_routing: 'wrong_workflow',
  wrong_answer: 'unresolved_request',
  robotic_pacing: 'long_pause'
};

export function normalizeMomentType(value: string): EvidenceMomentType {
  const raw = value.toLowerCase().replace(/\s+/g, '_');
  if (raw in MOMENT_ALIASES) return MOMENT_ALIASES[raw];
  const allowed: EvidenceMomentType[] = [
    'repeated_authentication',
    'missing_alternative_verification',
    'caller_cut_off',
    'long_pause',
    'wrong_workflow',
    'unresolved_request',
    'escalation',
    'product_availability',
    'missing_integration',
    'manual_highlight',
    'other'
  ];
  return allowed.includes(raw as EvidenceMomentType) ? (raw as EvidenceMomentType) : 'other';
}

function norm(s: string) {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

export function isAgentStillThereLine(text: string) {
  const s = norm(text);
  return /(sind sie noch da|bist du noch da|are you still there|hmm[,.\s]*(sind sie|bist du))/.test(s);
}

export function fixEvidenceSpeaker(moment: Partial<EvidenceMoment>): EvidenceSpeaker {
  const q = norm(moment.quote_or_transcript_excerpt || '');
  if (isAgentStillThereLine(q)) return 'agent';
  if (/(bitte nennen sie|versicherungsnummer|geburtsdatum|ich leite|kundenservice|einen moment)/.test(q)) {
    return 'agent';
  }
  if (/(ich möchte|ich moechte|ich wollte|ich brauche|das habe ich|hören sie mich|hoeren sie mich)/.test(q)) {
    return 'caller';
  }
  return (moment.speaker as EvidenceSpeaker) || 'unknown';
}

/** Contextual supplement only — never keyword-tag normal auth. */
export function detectHeuristicEvidence(
  transcript: string,
  callId: string,
  segments: TranscriptSegment[] | undefined,
  understanding: CallUnderstanding
): Partial<EvidenceMoment>[] {
  if (understanding.request_completed && understanding.authentication_normal && !understanding.repeated_auth_failure) {
    return [];
  }
  return detectContextualEvidence(understanding, transcript, callId, segments);
}

export function mergeEvidenceLists(
  ai: Partial<EvidenceMoment>[],
  heuristic: Partial<EvidenceMoment>[],
  max = 3
): Partial<EvidenceMoment>[] {
  const seen = new Set<string>();
  const merged: Partial<EvidenceMoment>[] = [];
  for (const e of [...ai, ...heuristic]) {
    const key = `${e.moment_type}:${norm(e.quote_or_transcript_excerpt || '').slice(0, 50)}`;
    if (!key || key.length < 8 || seen.has(key)) continue;
    seen.add(key);
    merged.push({ ...e, speaker: fixEvidenceSpeaker(e) });
    if (merged.length >= max) break;
  }
  return merged;
}
