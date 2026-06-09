import type { CallReview, AnliegenCategory, SolvedStatus, MainIssueLabel, TranscriptSegment } from '../types/CallReview';
import type { EvidenceMoment, EvidenceMomentType } from '../types/EvidenceMoment';
import {
  analyzeCallContext,
  filterEvidenceList,
  type CallUnderstanding
} from '../analysis/callUnderstanding';
import { applyIntentSafeguards } from './intentSafeguards';
import { deriveMainIssue, normalizeMainIssueLabel } from './issueLabels';
import { fixEvidenceSpeaker, normalizeMomentType } from './transcriptHeuristics';

export const ALLOWED_CALLER_REQUESTS = Object.keys({
  box_or_product_change: 1,
  order_status: 1,
  cancel_or_pause: 1,
  address_or_account_change: 1,
  authentication_problem: 1,
  new_customer_onboarding: 1,
  general_information_question: 1,
  other: 1
}) as AnliegenCategory[];

const ALLOWED_SOLVED: SolvedStatus[] = ['yes', 'partially', 'no'];

function normText(s: string) {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**

 * Caller request = original reason for calling.
 * Authentication must NOT override a clear service intent from the opening.
 */
export function resolveCallerRequest(
  aiValue: unknown,
  originalIntentSummary: string,
  transcript?: string
): AnliegenCategory {
  return applyIntentSafeguards(aiValue, originalIntentSummary, transcript || '');
}

/** Strict partially: handoff + next-step. Uses full-call understanding first. */
export function resolveSolvedStatus(
  aiValue: unknown,
  transcript: string,
  segments?: TranscriptSegment[],
  understanding?: CallUnderstanding
): SolvedStatus {
  const ctx =
    understanding ||
    analyzeCallContext(transcript, segments, { solved_status: aiValue });
  return ctx.solved_status;
}

export function buildCallUnderstanding(
  transcript: string,
  segments: TranscriptSegment[] | undefined,
  aiOut: Record<string, unknown>
): CallUnderstanding {
  const cu = (aiOut.call_understanding as Record<string, unknown>) || {};
  return analyzeCallContext(transcript, segments, {
    caller_request: aiOut.caller_request ?? aiOut.anliegen,
    original_intent_summary: String(aiOut.original_intent_summary || ''),
    solved_status: aiOut.solved_status,
    call_understanding: cu
  });
}

export function mapAiEvidenceRow(raw: Record<string, unknown>): Partial<EvidenceMoment> {
  const excerpt = String(
    raw.transcript_excerpt || raw.quote_or_transcript_excerpt || raw.excerpt || ''
  ).trim().slice(0, 280);
  const why = String(raw.why_it_matters || raw.explanation || '').trim();
  const fix = String(raw.suggested_fix || raw.recommended_fix || '').trim();
  return {
    moment_type: normalizeMomentType(String(raw.moment_type || '')),
    severity: raw.severity === 'high' || raw.severity === 'low' ? raw.severity : 'medium',
    speaker: raw.speaker === 'caller' || raw.speaker === 'agent' ? raw.speaker : 'unknown',
    timestamp_start_seconds: Number(raw.timestamp_start_seconds || 0),
    timestamp_end_seconds: Number(raw.timestamp_end_seconds || 0),
    quote_or_transcript_excerpt: excerpt,
    explanation: why || 'Operational friction visible in this transcript moment.',
    recommended_fix: fix || 'Review workflow handling for this moment type.',
    confidence:
      raw.confidence === 'high' || raw.confidence === 'low' ? raw.confidence : 'medium',
    linked_issue_suggestion: String(raw.linked_issue_suggestion || '').trim() || undefined,
    source: 'ai'
  };
}

export function sanitizeEvidenceMoments(
  raw: Partial<EvidenceMoment>[],
  transcript: string,
  understanding: CallUnderstanding,
  max = 2
): Partial<EvidenceMoment>[] {
  const normalized = raw.map(e => {
    const quote = String(e.quote_or_transcript_excerpt || '').trim().slice(0, 280);
    const moment_type = normalizeMomentType(String(e.moment_type || ''));
    return {
      ...e,
      moment_type,
      speaker: fixEvidenceSpeaker({ ...e, quote_or_transcript_excerpt: quote }),
      quote_or_transcript_excerpt: quote
    };
  });
  return filterEvidenceList(normalized, understanding, transcript, max);
}

export function syncCallFlagsFromEvidence(
  call: Partial<CallReview>,
  evidence: Partial<EvidenceMoment>[],
  understanding?: CallUnderstanding
): Partial<CallReview> {
  const types = new Set(evidence.map(e => normalizeMomentType(String(e.moment_type || ''))));
  const auth = types.has('repeated_authentication') || types.has('missing_alternative_verification');
  const u = understanding;
  return {
    ...call,
    caller_cut_off: types.has('caller_cut_off'),
    awkward_pauses: types.has('long_pause'),
    repeated_question: types.has('repeated_authentication'),
    identification_problem: auth || (u?.repeated_auth_failure ?? false),
    missing_integration: types.has('missing_integration'),
    latency_too_long: types.has('long_pause')
  };
}

export function clampRating(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(10, Math.round(n)));
}

export function computeRatings(
  call: Pick<
    CallReview,
    | 'solved_status'
    | 'caller_cut_off'
    | 'awkward_pauses'
    | 'latency_too_long'
    | 'repeated_question'
    | 'identification_problem'
    | 'missing_integration'
  >,
  evidence: Partial<EvidenceMoment>[]
): { overall_rating: number; naturalness_rating: number } {
  const friction = evidence.length + (call.identification_problem ? 1 : 0) + (call.caller_cut_off ? 1 : 0);
  let overall =
    call.solved_status === 'yes'
      ? friction <= 1
        ? 9
        : 7
      : call.solved_status === 'partially'
        ? friction <= 2
          ? 6
          : 5
        : friction >= 3
          ? 2
          : 4;
  let naturalness = call.solved_status === 'yes' ? 8 : 6;

  const high = evidence.filter(e => e.severity === 'high').length;
  const medium = evidence.filter(e => e.severity === 'medium').length;
  overall -= high * 1 + medium * 0.35;

  if (call.caller_cut_off) {
    overall -= 1.5;
    naturalness -= 1.5;
  }
  if (call.awkward_pauses) {
    overall -= 0.75;
    naturalness -= 1.25;
  }
  if (call.repeated_question || call.identification_problem) overall -= 1;
  if (call.missing_integration) overall -= 1.5;
  if (call.latency_too_long) {
    overall -= 0.5;
    naturalness -= 1;
  }

  return {
    overall_rating: Math.max(1, Math.min(10, Math.round(overall))),
    naturalness_rating: Math.max(1, Math.min(10, Math.round(naturalness)))
  };
}

export function finalizeCallAnalysis(
  call: Partial<CallReview>,
  evidence: EvidenceMoment[],
  aiRatings?: { overall_rating?: unknown; naturalness_rating?: unknown },
  understanding?: CallUnderstanding
): { call: Partial<CallReview>; evidence: EvidenceMoment[] } {
  const reviewerEvidence = evidence.filter(e => e.source === 'manual' || !e.source);
  const flagEvidence = reviewerEvidence.length ? reviewerEvidence : evidence;
  const computed = computeRatings(call as CallReview, flagEvidence);
  let primary_issue_label = deriveMainIssue(call, flagEvidence);
  if (
    understanding?.request_completed &&
    understanding.authentication_normal &&
    evidence.length === 0
  ) {
    primary_issue_label = 'No major issue';
  } else if (understanding?.request_completed && evidence.every(e => e.severity !== 'high')) {
    const fromAi = normalizeMainIssueLabel(String(call.primary_issue_label || ''));
    if (!fromAi || fromAi === 'Escalated to human' || fromAi === 'Repeated authentication') {
      primary_issue_label = evidence.length ? deriveMainIssue(call, evidence) : 'No major issue';
    }
  }
  return {
    call: {
      ...call,
      primary_issue_label,
      overall_rating: clampRating(aiRatings?.overall_rating, computed.overall_rating),
      naturalness_rating: clampRating(aiRatings?.naturalness_rating, computed.naturalness_rating)
    },
    evidence
  };
}

export function parseSecondaryIssues(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(v => normalizeMainIssueLabel(String(v)))
    .filter((v): v is MainIssueLabel => !!v)
    .slice(0, 3);
}
