import type { CallReview, SolvedStatus } from '../types/CallReview';
import type { EvidenceMoment } from '../types/EvidenceMoment';
import type { MainIssueLabel } from '../types/CallReview';
import { callerRequestLabels } from './anliegen';
import { deriveMainIssue, normalizeMainIssueLabel } from './issueLabels';
import { normalizeCallerRequest, normalizeResult } from './filterNormalize';

export type CallGroupKey = string;
export type GroupByMode = 'anliegen' | 'main_issue';

export interface CallGroup {
  key: CallGroupKey;
  title: string;
  kind: 'issue' | 'request' | 'result';
  calls: CallReview[];
}

const RESULT_TITLES: Record<SolvedStatus, string> = {
  yes: 'Completed (yes)',
  partially: 'Partial / escalated',
  no: 'Unresolved (no)'
};

export function getCallGroupTitle(
  call: CallReview,
  evidence: EvidenceMoment[],
  groupBy: GroupByMode = 'anliegen'
): string {
  if (groupBy === 'main_issue') {
    const mainIssue = deriveMainIssue(call, evidence);
    if (mainIssue !== 'No major issue') return mainIssue;
    const req = normalizeCallerRequest(call.anliegen);
    if (req !== 'other') return callerRequestLabels[req];
    return RESULT_TITLES[normalizeResult(call.solved_status)];
  }

  const req = normalizeCallerRequest(call.anliegen);
  if (req !== 'other') return callerRequestLabels[req];
  const mainIssue = deriveMainIssue(call, evidence);
  if (mainIssue !== 'No major issue') return mainIssue;
  return RESULT_TITLES[normalizeResult(call.solved_status)];
}

export function getCallGroupKey(
  call: CallReview,
  evidence: EvidenceMoment[],
  groupBy: GroupByMode = 'anliegen'
): CallGroupKey {
  if (groupBy === 'main_issue') {
    const mainIssue = deriveMainIssue(call, evidence);
    if (mainIssue !== 'No major issue') return `issue:${mainIssue}`;
    const req = normalizeCallerRequest(call.anliegen);
    if (req !== 'other') return `request:${req}`;
    return `result:${normalizeResult(call.solved_status)}`;
  }

  const req = normalizeCallerRequest(call.anliegen);
  if (req !== 'other') return `request:${req}`;
  const mainIssue = deriveMainIssue(call, evidence);
  if (mainIssue !== 'No major issue') return `issue:${mainIssue}`;
  return `result:${normalizeResult(call.solved_status)}`;
}

export function groupCalls(
  calls: CallReview[],
  allEvidence: EvidenceMoment[],
  groupBy: GroupByMode = 'anliegen'
): CallGroup[] {
  const byKey = new Map<CallGroupKey, CallReview[]>();

  for (const call of calls) {
    const ev = allEvidence.filter(e => e.call_id === call.id);
    const key = getCallGroupKey(call, ev, groupBy);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push(call);
  }

  const groups: CallGroup[] = [];
  for (const [key, groupedCalls] of byKey) {
    const sample = groupedCalls[0];
    const ev = allEvidence.filter(e => e.call_id === sample.id);
    const title = getCallGroupTitle(sample, ev, groupBy);
    const kind = key.startsWith('issue:') ? 'issue' : key.startsWith('request:') ? 'request' : 'result';
    groups.push({ key, title, kind, calls: groupedCalls });
  }

  const issueOrder: MainIssueLabel[] = [
    'Authentication failure',
    'Repeated authentication',
    'Missing alternative verification',
    'Caller interrupted / cut off',
    'Long pause / dead air',
    'Missing integration',
    'Wrong intent / wrong workflow',
    'Escalated to human',
    'Product availability issue',
    'Knowledge gap',
    'No major issue'
  ];

  const requestOrder = Object.keys(callerRequestLabels);

  return groups.sort((a, b) => {
    if (groupBy === 'anliegen') {
      const aReq = a.key.startsWith('request:') ? a.key.slice(8) : '';
      const bReq = b.key.startsWith('request:') ? b.key.slice(8) : '';
      const ai = aReq ? requestOrder.indexOf(aReq) : 99;
      const bi = bReq ? requestOrder.indexOf(bReq) : 99;
      if (ai !== bi) return ai - bi;
    } else {
      const aIssue = normalizeMainIssueLabel(a.title);
      const bIssue = normalizeMainIssueLabel(b.title);
      const ai = aIssue ? issueOrder.indexOf(aIssue) : 99;
      const bi = bIssue ? issueOrder.indexOf(bIssue) : 99;
      if (ai !== bi) return ai - bi;
    }
    const newestA = Math.max(...a.calls.map(c => Date.parse(c.date) || 0));
    const newestB = Math.max(...b.calls.map(c => Date.parse(c.date) || 0));
    return newestB - newestA;
  });
}

export function groupStats(calls: CallReview[], allEvidence: EvidenceMoment[]) {
  let pinned = 0;
  let highSeverity = 0;
  const results: Record<SolvedStatus, number> = { yes: 0, partially: 0, no: 0 };

  for (const call of calls) {
    if (call.pinned) pinned++;
    const ev = allEvidence.filter(e => e.call_id === call.id);
    if (ev.some(e => e.severity === 'high') || call.critical) highSeverity++;
    results[normalizeResult(call.solved_status)]++;
  }

  const topResult = (Object.entries(results).sort((a, b) => b[1] - a[1])[0]?.[0] || 'no') as SolvedStatus;
  const newest = calls.reduce((best, c) => (String(c.date) > String(best) ? c.date : best), '');

  return { pinned, highSeverity, topResult, newest, count: calls.length };
}
