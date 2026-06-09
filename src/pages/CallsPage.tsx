import { useEffect, useMemo, useState } from 'react';
import type { Database } from '../services/storageService';
import type { CallReview } from '../types/CallReview';
import {
  callMatchesSearch,
  countActiveFilters,
  DEFAULT_CALL_FILTERS,
  hasNonDefaultViewMode,
  loadSavedFilters,
  matchesCallerRequestFilter,
  matchesEvidenceTypeFilter,
  matchesMainIssueFilter,
  matchesResultFilter,
  matchesTriageFilter,
  matchesReviewStatusFilter,
  saveCallFilters,
  sortCallsForReview,
  type CallTriageFilter,
  type GroupByMode,
  type ReviewStatusFilter
} from '../utils/filterNormalize';
import { groupCalls } from '../utils/callGrouping';
import { toggleCallFlag } from '../services/callTriageService';
import { deleteCallWithAudio } from '../services/callsService';
import { ConfirmDeleteModal } from '../components/ui/ConfirmDeleteModal';
import { buildDuplicateIndex } from '../services/duplicateService';
import { CallReviewShell } from '../components/calls/CallReviewShell';
import { CallFiltersBar } from '../components/calls/CallFiltersBar';
import { GroupedCallsView } from '../components/calls/GroupedCallsView';
import { CallsTableView } from '../components/calls/CallsTableView';
import { callWorkspace, loadSavedWorkspace, saveWorkspace, workspaceLabel } from '../utils/workspace';

export function CallsPage({
  db,
  setDb,
  selectedCallId,
  selectedEvidenceId,
  onClearSelection,
  initialWorkspace,
  onWorkspaceChange
}: {
  db: Database;
  setDb: (db: Database) => void;
  selectedCallId?: string;
  selectedEvidenceId?: string;
  onClearSelection?: () => void;
  initialWorkspace?: 'production' | 'test';
  onWorkspaceChange?: (workspace: 'production' | 'test') => void;
}) {
  const saved = loadSavedFilters();
  const [workspace, setWorkspaceState] = useState<'production' | 'test'>(
    () => initialWorkspace || loadSavedWorkspace()
  );
  const setWorkspace = (next: 'production' | 'test') => {
    setWorkspaceState(next);
    saveWorkspace(next);
    onWorkspaceChange?.(next);
  };
  const [q, setQ] = useState(saved.q || '');
  const [detail, setDetail] = useState<CallReview | null>(() =>
    selectedCallId ? db.calls.find(c => c.id === selectedCallId) || null : null
  );
  const [requestFilter, setRequestFilter] = useState<CallReview['anliegen'] | 'all'>(saved.requestFilter || 'all');
  const [resultFilter, setResultFilter] = useState<CallReview['solved_status'] | 'all'>(saved.resultFilter || 'all');
  const [mainIssueFilter, setMainIssueFilter] = useState(saved.mainIssueFilter || 'all');
  const [triageFilter, setTriageFilter] = useState<CallTriageFilter>(saved.triageFilter || 'all');
  const [reviewStatusFilter, setReviewStatusFilter] = useState<ReviewStatusFilter>(saved.reviewStatusFilter || 'all');
  const [evidenceTypeFilter, setEvidenceTypeFilter] = useState(saved.evidenceTypeFilter || 'all');
  const [viewMode, setViewMode] = useState<'grouped' | 'table'>(saved.viewMode || 'grouped');
  const [groupBy, setGroupBy] = useState<GroupByMode>(saved.groupBy || 'anliegen');
  const [deleteCallId, setDeleteCallId] = useState<string | null>(null);

  useEffect(() => {
    if (selectedCallId) setDetail(db.calls.find(c => c.id === selectedCallId) || null);
  }, [selectedCallId, db.calls]);

  useEffect(() => {
    saveCallFilters({
      q,
      requestFilter,
      resultFilter,
      mainIssueFilter,
      triageFilter,
      reviewStatusFilter,
      evidenceTypeFilter,
      viewMode,
      groupBy
    });
  }, [q, requestFilter, resultFilter, mainIssueFilter, triageFilter, reviewStatusFilter, evidenceTypeFilter, viewMode, groupBy]);

  const scopeCalls = useMemo(
    () => db.calls.filter(c => callWorkspace(c) === workspace),
    [db.calls, workspace]
  );

  const duplicateIndex = useMemo(() => buildDuplicateIndex(scopeCalls), [scopeCalls]);

  const filteredCalls = useMemo(() => {
    return scopeCalls.filter(c => {
      const ev = db.evidence.filter(e => e.call_id === c.id);
      return (
        callMatchesSearch(c, ev, q) &&
        matchesCallerRequestFilter(c, requestFilter) &&
        matchesResultFilter(c, resultFilter) &&
        matchesMainIssueFilter(c, ev, mainIssueFilter) &&
        matchesTriageFilter(c, ev, triageFilter) &&
        matchesReviewStatusFilter(c, reviewStatusFilter) &&
        matchesEvidenceTypeFilter(ev, evidenceTypeFilter)
      );
    });
  }, [scopeCalls, db.evidence, q, requestFilter, resultFilter, mainIssueFilter, triageFilter, reviewStatusFilter, evidenceTypeFilter]);

  const rows = useMemo(() => [...filteredCalls].sort(sortCallsForReview), [filteredCalls]);
  const groups = useMemo(() => groupCalls(rows, db.evidence, groupBy), [rows, db.evidence, groupBy]);

  const activeFilterCount = countActiveFilters({
    q,
    requestFilter,
    resultFilter,
    mainIssueFilter,
    triageFilter,
    reviewStatusFilter,
    evidenceTypeFilter
  });
  const filtersActive = activeFilterCount > 0 || hasNonDefaultViewMode({ viewMode });

  function clearFilters() {
    setQ(DEFAULT_CALL_FILTERS.q);
    setRequestFilter(DEFAULT_CALL_FILTERS.requestFilter);
    setResultFilter(DEFAULT_CALL_FILTERS.resultFilter);
    setMainIssueFilter(DEFAULT_CALL_FILTERS.mainIssueFilter);
    setTriageFilter(DEFAULT_CALL_FILTERS.triageFilter);
    setReviewStatusFilter(DEFAULT_CALL_FILTERS.reviewStatusFilter);
    setEvidenceTypeFilter(DEFAULT_CALL_FILTERS.evidenceTypeFilter);
    setViewMode(DEFAULT_CALL_FILTERS.viewMode);
    setGroupBy(DEFAULT_CALL_FILTERS.groupBy);
  }

  function closeDetail() {
    setDetail(null);
    onClearSelection?.();
  }

  const activeCall = detail ? db.calls.find(c => c.id === detail.id) || detail : null;
  const activeEvidence = activeCall ? db.evidence.filter(e => e.call_id === activeCall.id) : [];

  if (activeCall) {
    return (
      <CallReviewShell
        mode="page"
        db={db}
        setDb={setDb}
        call={activeCall}
        evidence={activeEvidence}
        initialEvidenceId={selectedEvidenceId}
        onClose={closeDetail}
      />
    );
  }

  const groupByLabel = groupBy === 'anliegen' ? 'Anliegen' : 'main issue';

  return (
    <main className="page calls-cockpit">
      <div className="page-head">
        <div>
          <h1>Calls</h1>
          <p className="muted">
            Saved call library — grouped by {groupByLabel}.{' '}
            <span className="badge blue">
              Showing {workspaceLabel(workspace)} ({scopeCalls.length})
            </span>
            {rows.length !== scopeCalls.length && (
              <span className="muted"> · {rows.length} after filters</span>
            )}
          </p>
        </div>
        <div className="row wrap workspace-toggle">
          <button
            type="button"
            className={workspace === 'production' ? 'primary-soft' : ''}
            onClick={() => setWorkspace('production')}
          >
            Production
          </button>
          <button
            type="button"
            className={workspace === 'test' ? 'primary-soft' : ''}
            onClick={() => setWorkspace('test')}
          >
            Test
          </button>
        </div>
      </div>

      <section className="panel">
        <CallFiltersBar
          q={q}
          setQ={setQ}
          requestFilter={requestFilter}
          setRequestFilter={setRequestFilter}
          resultFilter={resultFilter}
          setResultFilter={setResultFilter}
          mainIssueFilter={mainIssueFilter}
          setMainIssueFilter={setMainIssueFilter}
          triageFilter={triageFilter}
          setTriageFilter={setTriageFilter}
          reviewStatusFilter={reviewStatusFilter}
          setReviewStatusFilter={setReviewStatusFilter}
          evidenceTypeFilter={evidenceTypeFilter}
          setEvidenceTypeFilter={setEvidenceTypeFilter}
          viewMode={viewMode}
          setViewMode={setViewMode}
          groupBy={groupBy}
          setGroupBy={setGroupBy}
          resultCount={rows.length}
          activeFilterCount={activeFilterCount}
          filtersActive={filtersActive}
          onClearFilters={clearFilters}
        />

        {viewMode === 'grouped' ? (
          <GroupedCallsView
            groups={groups}
            allEvidence={db.evidence}
            onOpen={setDetail}
            onPin={c => setDb(toggleCallFlag(db, c.id, 'pinned'))}
            onDelete={c => setDeleteCallId(c.id)}
          />
        ) : (
          <CallsTableView
            rows={rows}
            evidence={db.evidence}
            duplicateIndex={duplicateIndex}
            onOpen={setDetail}
            onPin={c => setDb(toggleCallFlag(db, c.id, 'pinned'))}
            onDelete={setDeleteCallId}
          />
        )}
      </section>

      {deleteCallId && (
        <ConfirmDeleteModal
          title="Delete call review?"
          description="Permanently removes this call and all evidence from local storage."
          onCancel={() => setDeleteCallId(null)}
          onConfirm={async () => {
            setDb(await deleteCallWithAudio(db, deleteCallId));
            if (detail?.id === deleteCallId) closeDetail();
            setDeleteCallId(null);
          }}
        />
      )}
    </main>
  );
}
