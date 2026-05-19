import type { CallReview } from '../types/CallReview';
import type { Issue } from '../types/Issue';
import type { EvidenceMoment } from '../types/EvidenceMoment';
import { anliegenOrder } from './anliegen';
export const activeIssues = (issues: Issue[]) => issues.filter(i => !['resolved','ignored'].includes(i.status));
export const highSeverity = (issues: Issue[], evidence: EvidenceMoment[]) => issues.filter(i => i.severity === 'high' && !['resolved','ignored'].includes(i.status)).length + evidence.filter(e => e.severity === 'high').length;
export const requestCounts = (calls: CallReview[]) => anliegenOrder.map(key => ({ key, count: calls.filter(c => c.anliegen === key).length }));
export const evidenceForIssue = (moments: EvidenceMoment[], issueId: string) => moments.filter(m => m.issue_id === issueId);
export const lastSeenForIssue = (issue: Issue, calls: CallReview[]) => {
  const dates = issue.linked_call_ids.map(id => calls.find(c => c.id === id || c.call_id === id)?.date).filter(Boolean).sort();
  return dates[dates.length - 1];
};
