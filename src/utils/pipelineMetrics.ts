import type { Database } from '../services/storageService';
import type { CallReview } from '../types/CallReview';
import { getEvidenceReviewStatus, isAiSuggested } from './evidenceReview';

export function countSavedToday(calls: CallReview[]): number {
  const today = new Date().toISOString().slice(0, 10);
  return calls.filter(c => (c.updated_at || c.created_at || '').slice(0, 10) === today).length;
}

export function countFlaggedCalls(calls: CallReview[]): number {
  return calls.filter(c => c.review_status === 'flagged' || (c.linked_issue_ids?.length ?? 0) > 0).length;
}

export function countLinkedToIssues(calls: CallReview[]): number {
  return calls.filter(c => (c.linked_issue_ids?.length ?? 0) > 0).length;
}

export function inboxPipelineMetrics(db: Database) {
  const drafts = db.drafts || [];
  const calls = db.calls;
  const processing = drafts.filter(d => d.status === 'queued' || d.status === 'processing').length;
  const ready = drafts.filter(d => d.status === 'ready').length;
  const failed = drafts.filter(d => d.status === 'failed').length;
  const savedToday = countSavedToday(calls);
  const flagged = countFlaggedCalls(calls);
  const linked = countLinkedToIssues(calls);
  const withPendingFindings = drafts.filter(d =>
    d.status === 'ready' &&
    (d.evidence || []).some(e => isAiSuggested(e) && getEvidenceReviewStatus(e) === 'pending')
  ).length;

  return { processing, ready, failed, savedToday, flagged, linked, withPendingFindings };
}
