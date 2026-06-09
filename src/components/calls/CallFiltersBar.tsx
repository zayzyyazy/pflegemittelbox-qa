import { useState } from 'react';
import type { CallReview } from '../../types/CallReview';
import type { EvidenceMoment } from '../../types/EvidenceMoment';
import type { AnliegenCategory, SolvedStatus } from '../../types/CallReview';
import { callerRequestLabels } from '../../utils/anliegen';
import { MAIN_ISSUE_LABELS } from '../../utils/issueLabels';
import type { CallTriageFilter, GroupByMode, ReviewStatusFilter } from '../../utils/filterNormalize';

type Props = {
  q: string;
  setQ: (v: string) => void;
  requestFilter: AnliegenCategory | 'all';
  setRequestFilter: (v: AnliegenCategory | 'all') => void;
  resultFilter: SolvedStatus | 'all';
  setResultFilter: (v: SolvedStatus | 'all') => void;
  mainIssueFilter: string;
  setMainIssueFilter: (v: string) => void;
  triageFilter: CallTriageFilter;
  setTriageFilter: (v: CallTriageFilter) => void;
  reviewStatusFilter: ReviewStatusFilter;
  setReviewStatusFilter: (v: ReviewStatusFilter) => void;
  evidenceTypeFilter: string;
  setEvidenceTypeFilter: (v: string) => void;
  viewMode: 'grouped' | 'table';
  setViewMode: (v: 'grouped' | 'table') => void;
  groupBy: GroupByMode;
  setGroupBy: (v: GroupByMode) => void;
  resultCount: number;
  activeFilterCount?: number;
  filtersActive?: boolean;
  onClearFilters?: () => void;
};

export function CallFiltersBar(props: Props) {
  const {
    q, setQ,
    requestFilter, setRequestFilter,
    resultFilter, setResultFilter,
    mainIssueFilter, setMainIssueFilter,
    triageFilter, setTriageFilter,
    reviewStatusFilter, setReviewStatusFilter,
    evidenceTypeFilter, setEvidenceTypeFilter,
    viewMode, setViewMode,
    groupBy, setGroupBy,
    resultCount,
    activeFilterCount = 0,
    filtersActive = false,
    onClearFilters
  } = props;

  const [filtersOpen, setFiltersOpen] = useState(false);
  const extraFiltersActive =
    (activeFilterCount ?? 0) > 0 || requestFilter !== 'all' || resultFilter !== 'all' ||
    mainIssueFilter !== 'all' || triageFilter !== 'all' || reviewStatusFilter !== 'all' ||
    evidenceTypeFilter !== 'all';

  return (
    <>
      <input
        className="search"
        value={q}
        onChange={e => setQ(e.target.value)}
        placeholder="Search Kunde, VNR, call ID, transcript, friction…"
      />
      <div className={`filters-toggle-row${filtersOpen ? '' : ' filters-collapsed'}`}>
        <select value={viewMode} onChange={e => setViewMode(e.target.value as 'grouped' | 'table')}>
          <option value="grouped">Grouped view</option>
          <option value="table">Table view</option>
        </select>
        {viewMode === 'grouped' && (
          <select value={groupBy} onChange={e => setGroupBy(e.target.value as GroupByMode)}>
            <option value="anliegen">Group by: Anliegen</option>
            <option value="main_issue">Group by: Main issue</option>
          </select>
        )}
        <button type="button" className="btn-sm" onClick={() => setFiltersOpen(v => !v)}>
          {filtersOpen ? 'Hide filters' : `Filters${extraFiltersActive ? ` (${activeFilterCount || 'on'})` : ''}`}
        </button>
        <span className="muted filter-count">{resultCount} calls</span>
        {filtersActive && onClearFilters && (
          <button type="button" className="btn-sm primary-soft" onClick={onClearFilters}>
            Clear filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
          </button>
        )}
      </div>
      <div className={`row wrap filters calls-filters calls-filters-extra${filtersOpen ? '' : ' filters-collapsed'}`} style={filtersOpen ? undefined : { display: 'none' }}>
        <select value={requestFilter} onChange={e => setRequestFilter(e.target.value as AnliegenCategory | 'all')}>
          <option value="all">All caller requests</option>
          {Object.entries(callerRequestLabels).map(([key, label]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>
        <select value={resultFilter} onChange={e => setResultFilter(e.target.value as SolvedStatus | 'all')}>
          <option value="all">All results</option>
          <option value="yes">yes</option>
          <option value="partially">partially</option>
          <option value="no">no</option>
        </select>
        <select value={mainIssueFilter} onChange={e => setMainIssueFilter(e.target.value)}>
          <option value="all">All main issues</option>
          {MAIN_ISSUE_LABELS.map(label => (
            <option key={label} value={label}>{label}</option>
          ))}
        </select>
        <select value={triageFilter} onChange={e => setTriageFilter(e.target.value as CallTriageFilter)}>
          <option value="all">All triage</option>
          <option value="pinned">Pinned only</option>
          <option value="has_evidence">Has findings</option>
          <option value="has_issue">Linked to issue</option>
          <option value="not_reviewed">Not reviewed</option>
          <option value="flagged">Flagged</option>
          <option value="critical">Critical</option>
          <option value="needs_review">Needs review</option>
          <option value="watch_later">Watch later</option>
          <option value="high_severity">High severity</option>
          <option value="escalation">Escalation</option>
          <option value="unresolved">Unresolved</option>
          <option value="interruption">Interruption</option>
          <option value="starred">Starred</option>
        </select>
        <select value={reviewStatusFilter} onChange={e => setReviewStatusFilter(e.target.value as ReviewStatusFilter)}>
          <option value="all">All review status</option>
          <option value="new">new</option>
          <option value="reviewed">reviewed</option>
          <option value="flagged">flagged</option>
        </select>
        <select value={evidenceTypeFilter} onChange={e => setEvidenceTypeFilter(e.target.value)}>
          <option value="all">All evidence types</option>
          <option value="escalation">escalation</option>
          <option value="repeated_authentication">repeated auth</option>
          <option value="long_pause">long pause</option>
          <option value="caller_cut_off">caller cut off</option>
          <option value="missing_integration">missing integration</option>
          <option value="manual_highlight">reviewer highlight</option>
        </select>
      </div>
    </>
  );
}
