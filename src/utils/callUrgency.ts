import type { CallReview } from '../types/CallReview';
import type { EvidenceMoment } from '../types/EvidenceMoment';

export type CatastropheLevel = 'critical' | 'high' | 'medium' | 'low';

export type CallUrgencyScore = {
  call: CallReview;
  score: number;
  catastrophe: CatastropheLevel;
  reasons: string[];
  suggestedAction: string;
  pendingFindings: number;
  highFindings: number;
};

const IN_SCOPE_ANLIEGEN = new Set([
  'cancel_or_pause',
  'box_or_product_change',
  'address_or_account_change',
  'order_status'
]);

function evidenceForCall(callId: string, evidence: EvidenceMoment[]) {
  return evidence.filter(e => e.call_id === callId && e.reviewer_status !== 'dismissed');
}

function hasIssueLabel(call: CallReview, evidence: EvidenceMoment[], patterns: RegExp[]) {
  const blob = [
    call.primary_issue_label || '',
    ...evidence.map(e => `${e.moment_type} ${e.linked_issue_suggestion || ''} ${e.explanation}`)
  ].join(' ').toLowerCase();
  return patterns.some(re => re.test(blob));
}

export function scoreCallUrgency(call: CallReview, evidence: EvidenceMoment[]): CallUrgencyScore {
  const ev = evidenceForCall(call.id, evidence);
  const pending = ev.filter(e => e.reviewer_status === 'pending' || e.source === 'system_rule').length;
  const high = ev.filter(f => f.severity === 'high').length;
  const reasons: string[] = [];
  let score = 0;

  if (call.review_status !== 'reviewed' && call.review_status !== 'flagged') {
    score += 8;
    reasons.push('Not reviewed yet');
  }

  if (call.marie_call_status === 'dropped' || call.marie_call_status === 'failed') {
    score += 35;
    reasons.push(`Call ${call.marie_call_status}`);
  }

  if (call.solved_status === 'no' || call.marie_main_result === 'unresolved') {
    score += 22;
    reasons.push('Unresolved outcome');
  }

  if (hasIssueLabel(call, ev, [/function_api/, /missing_integration/])) {
    score += 40;
    reasons.push('Function/API failure detected');
  }

  if (hasIssueLabel(call, ev, [/repeated_birthday/, /repeated_authentication/, /verification_skipped/])) {
    score += 30;
    reasons.push('Auth / birthday capture problem');
  }

  if (hasIssueLabel(call, ev, [/transfer_failed/, /wrong_workflow/, /unnecessary/])) {
    score += 28;
    reasons.push('Transfer or workflow routing issue');
  }

  if (
    IN_SCOPE_ANLIEGEN.has(call.anliegen) &&
    (call.marie_main_result === 'transferred' || call.marie_call_status === 'transferred')
  ) {
    score += 25;
    reasons.push('Forwarded though in-scope action may be possible');
  }

  const fnErrors = (call.function_calls || []).filter(f => f.status === 'error').length;
  if (fnErrors > 0) {
    score += 32;
    reasons.push(`${fnErrors} function error(s)`);
  }

  if (high > 0) {
    score += high * 12;
    reasons.push(`${high} high-severity finding(s)`);
  }

  if (pending > 0) {
    score += pending * 6;
    reasons.push(`${pending} open finding(s) to confirm`);
  }

  if (call.critical) score += 20;

  const catastrophe: CatastropheLevel =
    score >= 70 ? 'critical' :
    score >= 45 ? 'high' :
    score >= 22 ? 'medium' : 'low';

  const suggestedAction =
    catastrophe === 'critical'
      ? 'Review immediately — likely production breakage (function fail, dropped call, or auth loop).'
      : catastrophe === 'high'
        ? 'Check function log vs transcript — confirm whether Marie could have acted in-flow.'
        : catastrophe === 'medium'
          ? 'Confirm AI/rule findings and link to an issue if pattern repeats.'
          : 'Quick triage — save or dismiss findings.';

  return {
    call,
    score,
    catastrophe,
    reasons: reasons.slice(0, 4),
    suggestedAction,
    pendingFindings: pending,
    highFindings: high
  };
}

export function rankCallsByUrgency(calls: CallReview[], evidence: EvidenceMoment[], limit = 12): CallUrgencyScore[] {
  return calls
    .map(call => scoreCallUrgency(call, evidence))
    .filter(row => row.score > 0)
    .sort((a, b) => b.score - a.score || b.highFindings - a.highFindings)
    .slice(0, limit);
}
