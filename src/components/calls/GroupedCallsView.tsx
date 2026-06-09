import { useState } from 'react';
import type { CallReview } from '../../types/CallReview';
import type { EvidenceMoment } from '../../types/EvidenceMoment';
import type { CallGroup } from '../../utils/callGrouping';
import { groupStats } from '../../utils/callGrouping';
import { shortCallId } from '../../utils/text';
import { CallerRequestTag } from './CallerRequestTag';
import { ResultPill } from './ResultPill';

function CompactCallCard({
  call,
  evidence,
  onOpen
}: {
  call: CallReview;
  evidence: EvidenceMoment[];
  onOpen: (c: CallReview) => void;
}) {
  const issueCount = call.linked_issue_ids?.length ?? 0;
  return (
    <article className="compact-call-card library-row" onClick={() => onOpen(call)} role="button" tabIndex={0}
      onKeyDown={e => { if (e.key === 'Enter') onOpen(call); }}>
      <div className="row between wrap">
        <strong className="library-call-id">{shortCallId(call.call_id)}</strong>
        <span className="muted library-date">{call.date}</span>
      </div>
      <div className="row wrap library-meta">
        <CallerRequestTag category={call.anliegen} />
        <ResultPill status={call.solved_status} />
        {evidence.length > 0 && <span className="badge yellow">{evidence.length} finding{evidence.length !== 1 ? 's' : ''}</span>}
        {issueCount > 0 && <span className="badge red">{issueCount} issue{issueCount !== 1 ? 's' : ''}</span>}
        {call.review_status === 'flagged' && <span className="badge red">flagged</span>}
        {call.pinned && <span className="badge blue">pinned</span>}
      </div>
      {call.call_summary && <p className="muted clamp-cell library-summary">{call.call_summary}</p>}
    </article>
  );
}

export function GroupedCallsView({
  groups,
  allEvidence,
  onOpen,
  onPin,
  onDelete,
  onReanalyze
}: {
  groups: CallGroup[];
  allEvidence: EvidenceMoment[];
  onOpen: (c: CallReview) => void;
  onPin: (c: CallReview) => void;
  onDelete: (c: CallReview) => void;
  onReanalyze?: (c: CallReview) => void;
}) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  void onPin;
  void onDelete;
  void onReanalyze;

  if (!groups.length) {
    return <p className="muted empty-filter">No calls match these filters.</p>;
  }

  return (
    <div className="grouped-calls">
      {groups.map(group => {
        const stats = groupStats(group.calls, allEvidence);
        const isCollapsed = collapsed[group.key] ?? false;
        return (
          <section className="call-group-card" key={group.key}>
            <button
              type="button"
              className="call-group-head"
              onClick={() => setCollapsed(c => ({ ...c, [group.key]: !isCollapsed }))}
            >
              <div>
                <h3>{group.title}</h3>
                <p className="meta">
                  {stats.count} calls · newest {stats.newest || '—'}
                </p>
              </div>
              <span className="muted">{isCollapsed ? 'Expand' : 'Collapse'}</span>
            </button>
            {!isCollapsed && (
              <div className="library-row-list">
                {group.calls.map(call => (
                  <CompactCallCard
                    key={call.id}
                    call={call}
                    evidence={allEvidence.filter(e => e.call_id === call.id)}
                    onOpen={onOpen}
                  />
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

export { CompactCallCard };
