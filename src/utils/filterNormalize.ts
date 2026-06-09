import type { AnliegenCategory, CallReview, SolvedStatus } from '../types/CallReview';
import type { EvidenceMoment } from '../types/EvidenceMoment';
import { callerRequestLabels, migrateAnliegenCategory } from './anliegen';
import { deriveMainIssue, normalizeMainIssueLabel, MAIN_ISSUE_LABELS } from './issueLabels';
import { formatFriction } from './friction';

export type CallTriageFilter =
  | 'all'
  | 'pinned'
  | 'critical'
  | 'needs_review'
  | 'watch_later'
  | 'high_severity'
  | 'escalation'
  | 'unresolved'
  | 'interruption'
  | 'starred'
  | 'has_evidence'
  | 'has_issue'
  | 'not_reviewed'
  | 'flagged';

export type ReviewStatusFilter = 'all' | 'new' | 'reviewed' | 'flagged';

export function normalizeCallerRequest(value?: string | null): AnliegenCategory {
  if (!value) return 'other';
  if (value in callerRequestLabels) return value as AnliegenCategory;
  return migrateAnliegenCategory(String(value));
}

export function normalizeResult(value?: string | null): SolvedStatus {
  const raw = String(value || '').toLowerCase().trim();
  if (raw === 'yes' || raw === 'solved') return 'yes';
  if (raw === 'partially' || raw === 'partial') return 'partially';
  return 'no';
}

export function matchesCallerRequestFilter(call: CallReview, filter: AnliegenCategory | 'all') {
  if (filter === 'all') return true;
  return normalizeCallerRequest(call.anliegen) === filter;
}

export function matchesResultFilter(call: CallReview, filter: SolvedStatus | 'all') {
  if (filter === 'all') return true;
  return normalizeResult(call.solved_status) === filter;
}

export function callHasEscalation(evidence: EvidenceMoment[]) {
  return evidence.some(e => e.moment_type === 'escalation');
}

export function callHasHighSeverity(evidence: EvidenceMoment[]) {
  return evidence.some(e => e.severity === 'high') || evidence.some(e => e.moment_type === 'caller_cut_off');
}

export function matchesMainIssueFilter(call: CallReview, evidence: EvidenceMoment[], filter: string) {
  if (filter === 'all') return true;
  const issue = deriveMainIssue(call, evidence);
  const normalized = normalizeMainIssueLabel(filter) || filter;
  return issue === normalized || issue.toLowerCase() === filter.toLowerCase();
}

export function matchesTriageFilter(
  call: CallReview,
  evidence: EvidenceMoment[],
  filter: CallTriageFilter
): boolean {
  if (filter === 'all') return true;
  if (filter === 'pinned') return !!call.pinned;
  if (filter === 'critical') return !!call.critical;
  if (filter === 'needs_review') return !!call.needs_review;
  if (filter === 'watch_later') return !!call.watch_later;
  if (filter === 'starred') return !!call.investigation_starred;
  if (filter === 'high_severity') return callHasHighSeverity(evidence) || !!call.critical;
  if (filter === 'escalation') return callHasEscalation(evidence) || !!call.engineering_escalated;
  if (filter === 'unresolved') return normalizeResult(call.solved_status) === 'no';
  if (filter === 'interruption') {
    return (
      !!call.caller_cut_off ||
      evidence.some(e => e.moment_type === 'caller_cut_off' || e.moment_type === 'long_pause')
    );
  }
  if (filter === 'has_evidence') return evidence.length > 0;
  if (filter === 'has_issue') return (call.linked_issue_ids?.length ?? 0) > 0;
  if (filter === 'not_reviewed') return call.review_status === 'new' || !!call.needs_review;
  if (filter === 'flagged') return call.review_status === 'flagged';
  return true;
}

export function matchesReviewStatusFilter(call: CallReview, filter: ReviewStatusFilter) {
  if (filter === 'all') return true;
  return (call.review_status || 'reviewed') === filter;
}

export function matchesEvidenceTypeFilter(evidence: EvidenceMoment[], type: string) {
  if (type === 'all') return true;
  return evidence.some(e => e.moment_type === type);
}

export function sortCallsForReview(a: CallReview, b: CallReview) {
  if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
  if (!!a.critical !== !!b.critical) return a.critical ? -1 : 1;
  if (!!a.needs_review !== !!b.needs_review) return a.needs_review ? -1 : 1;
  return String(b.date).localeCompare(String(a.date));
}

export function callMatchesSearch(call: CallReview, evidence: EvidenceMoment[], query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const mainIssue = deriveMainIssue(call, evidence);
  const friction = formatFriction(call, evidence);
  const haystack = [
    call.call_id,
    call.customer_name,
    call.vnr,
    call.phone,
    call.audio_file_name,
    call.transcript,
    call.call_summary,
    callerRequestLabels[normalizeCallerRequest(call.anliegen)],
    call.solved_status,
    mainIssue,
    friction,
    call.primary_friction,
    call.primary_issue_label,
    ...(call.reviewer_tags || []),
    call.pinned ? 'pinned' : '',
    call.critical ? 'critical' : '',
    ...evidence.map(e => [e.moment_type, e.quote_or_transcript_excerpt, e.explanation].join(' '))
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(q);
}

export const FILTER_STORAGE_KEY = 'pflegemittelbox-qa-filters-v1';

export type SavedCallFilters = {
  q: string;
  requestFilter: AnliegenCategory | 'all';
  resultFilter: SolvedStatus | 'all';
  mainIssueFilter: string;
  triageFilter: CallTriageFilter;
  reviewStatusFilter: ReviewStatusFilter;
  evidenceTypeFilter: string;
  viewMode: 'grouped' | 'table';
  groupBy: 'anliegen' | 'main_issue';
};

export type GroupByMode = SavedCallFilters['groupBy'];

export const DEFAULT_CALL_FILTERS: SavedCallFilters = {
  q: '',
  requestFilter: 'all',
  resultFilter: 'all',
  mainIssueFilter: 'all',
  triageFilter: 'all',
  reviewStatusFilter: 'all',
  evidenceTypeFilter: 'all',
  viewMode: 'grouped',
  groupBy: 'anliegen'
};

export function countActiveFilters(filters: Partial<SavedCallFilters>): number {
  let count = 0;
  if (filters.q?.trim()) count++;
  if (filters.requestFilter && filters.requestFilter !== 'all') count++;
  if (filters.resultFilter && filters.resultFilter !== 'all') count++;
  if (filters.mainIssueFilter && filters.mainIssueFilter !== 'all') count++;
  if (filters.triageFilter && filters.triageFilter !== 'all') count++;
  if (filters.reviewStatusFilter && filters.reviewStatusFilter !== 'all') count++;
  if (filters.evidenceTypeFilter && filters.evidenceTypeFilter !== 'all') count++;
  return count;
}

export function hasNonDefaultViewMode(filters: Partial<SavedCallFilters>): boolean {
  return !!filters.viewMode && filters.viewMode !== 'grouped';
}

export function loadSavedFilters(): Partial<SavedCallFilters> {
  try {
    const raw = localStorage.getItem(FILTER_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function saveCallFilters(filters: SavedCallFilters) {
  localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(filters));
}
