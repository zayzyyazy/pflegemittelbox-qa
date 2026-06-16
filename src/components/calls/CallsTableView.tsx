import type { CallReview } from '../../types/CallReview';
import type { EvidenceMoment } from '../../types/EvidenceMoment';
import { shortCallId } from '../../utils/text';
import { formatFriction } from '../../utils/friction';
import { normalizeCallerRequest } from '../../utils/filterNormalize';
import { CallerRequestTag } from './CallerRequestTag';
import { ResultPill } from './ResultPill';
import { scoreCallUrgency } from '../../utils/callUrgency';

function fmtDuration(seconds?: number) {
  const s = Math.max(0, Math.round(seconds || 0));
  const m = Math.floor(s / 60);
  const rest = s % 60;
  return `${m}:${String(rest).padStart(2, '0')}`;
}

export function CallsTableView({
  rows,
  evidence,
  duplicateIndex,
  onOpen,
  onPin,
  onDelete
}: {
  rows: CallReview[];
  evidence: EvidenceMoment[];
  duplicateIndex: Map<string, { call: CallReview; reason: string }>;
  onOpen: (c: CallReview) => void;
  onPin: (c: CallReview) => void;
  onDelete: (id: string) => void;
}) {
  if (!rows.length) {
    return <p className="muted empty-filter">No calls match these filters.</p>;
  }

  return (
    <div className="calls-table-wrap">
      <table className="calls-table operator-table calls-table-compact">
        <thead>
          <tr>
            <th></th>
            <th>Call</th>
            <th>Date</th>
            <th>Status</th>
            <th>Duration</th>
            <th>Request</th>
            <th>Result</th>
            <th>Issue</th>
            <th>Urgency</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map(c => {
            const ev = evidence.filter(e => e.call_id === c.id);
            const friction = formatFriction(c, ev);
            const dup = duplicateIndex.get(c.id);
            const urgency = scoreCallUrgency(c, ev);
            const rowClass = [c.pinned ? 'row-pinned' : '', dup ? 'row-duplicate' : '', `urgency-row-${urgency.catastrophe}`].filter(Boolean).join(' ');
            return (
              <tr key={c.id} className={rowClass || undefined} title={[dup ? `Duplicate: ${dup.reason}` : '', friction].filter(Boolean).join(' · ')}>
                <td className="pin-cell">
                  <button
                    type="button"
                    className={`pin-toggle${c.pinned ? ' on' : ''}`}
                    title={c.pinned ? 'Unpin' : 'Pin call'}
                    onClick={e => {
                      e.stopPropagation();
                      onPin(c);
                    }}
                  >
                    {c.pinned ? '★' : '☆'}
                  </button>
                  {c.critical && <span className="pin-badge critical">!</span>}
                </td>
                <td>
                  <button type="button" className="link-button" onClick={() => onOpen(c)}>{shortCallId(c.call_id)}</button>
                  {dup && <span className="dup-badge">Duplicate</span>}
                </td>
                <td className="muted-cell">{c.date}</td>
                <td><span className="badge neutral">{c.marie_call_status || c.leaping_status || '—'}</span></td>
                <td className="muted-cell">{fmtDuration(c.duration_seconds)}</td>
                <td><CallerRequestTag category={normalizeCallerRequest(c.anliegen)} /></td>
                <td>
                  {c.marie_main_result ? (
                    <span className="result-pill result-partially">{c.marie_main_result.replace(/_/g, ' ')}</span>
                  ) : (
                    <ResultPill status={c.solved_status} />
                  )}
                </td>
                <td className="clamp-cell" title={c.primary_issue_label || friction}>{c.primary_issue_label || '—'}</td>
                <td>
                  <span className={`badge ${urgency.catastrophe === 'critical' ? 'red' : urgency.catastrophe === 'high' ? 'yellow' : 'neutral'}`}>
                    {urgency.catastrophe}
                  </span>
                </td>
                <td>
                  <div className="btn-group">
                    <button type="button" className="btn-sm primary-soft" onClick={() => onOpen(c)}>View</button>
                    <button type="button" className="btn-sm btn-danger-soft" onClick={() => onDelete(c.id)}>Delete</button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
