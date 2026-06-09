import type { CallReview } from '../types/CallReview';
import type { EvidenceMoment } from '../types/EvidenceMoment';
import { deriveMainIssue, normalizeMainIssueLabel } from './issueLabels';
import { callerRequestLabels } from './anliegen';

/** Build 3–4 sentence QA notes including main issue for the Notes section. */
export function buildReviewerNotes(
  call: Partial<CallReview>,
  evidence: EvidenceMoment[],
  aiNotes?: string,
  aiMainIssue?: string
): string {
  const raw = String(aiNotes || call.reviewer_notes || '').trim();
  const sentences = raw.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 8);

  const mainIssue =
    normalizeMainIssueLabel(String(aiMainIssue || call.primary_issue_label || '')) ||
    deriveMainIssue(call as CallReview, evidence);
  const request = callerRequestLabels[(call.anliegen || 'other') as keyof typeof callerRequestLabels] || 'Other';
  const result = call.solved_status || 'no';
  const summary = String(call.call_summary || call.original_intent_summary || '').trim();

  if (sentences.length >= 3 && /main issue|hauptproblem|primary/i.test(raw)) {
    return raw.slice(0, 600);
  }

  const parts: string[] = [];

  parts.push(
    `Main issue for this call: ${mainIssue}. Caller request was ${request}; outcome ${result}.`
  );

  if (summary) {
    parts.push(summary.endsWith('.') ? summary : `${summary}.`);
  } else if (call.final_outcome) {
    parts.push(String(call.final_outcome));
  }

  if (evidence.length) {
    const top = evidence[0];
    parts.push(
      `Key moment: ${top.moment_type.replace(/_/g, ' ')} — "${top.quote_or_transcript_excerpt.slice(0, 120)}${top.quote_or_transcript_excerpt.length > 120 ? '…' : ''}".`
    );
  } else if (result === 'yes') {
    parts.push('No major operational friction was flagged; authentication and workflow appeared normal.');
  }

  if (raw && sentences.length) {
    parts.push(sentences.slice(0, 2).join(' '));
  }

  return parts.join(' ').slice(0, 600);
}
