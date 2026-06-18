import type { CallReview } from '../../types/CallReview';
import type { EvidenceMoment } from '../../types/EvidenceMoment';
import { shortCallId } from '../../utils/text';
import { formatFriction } from '../../utils/friction';
import { normalizeCallerRequest } from '../../utils/filterNormalize';
import { CallerRequestTag } from './CallerRequestTag';
import { ResultPill } from './ResultPill';
import { topOperationalLabel } from '../../utils/operationalFailures';

function fmtDuration(seconds?: number) {
  const s = Math.max(0, Math.round(seconds || 0));
  const m = Math.floor(s / 60);
  const rest = s % 60;
  return `${m}:${String(rest).padStart(2, '0')}`;
}

function issueSource(ev: EvidenceMoment[]) {
  if (ev.some(e => e.source === 'system_rule')) return 'rules';
  if (ev.some(e => e.source === 'ai_suggested' || e.source === 'ai' || e.source === 'audio_listener')) return 'AI';
  if (ev.some(e => e.source === 'manual')) return 'human';
  return '—';
}

function operationFlags(c: CallReview) {
  const label = topOperationalLabel(c);
  return label ? [label] : [];
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
      <table className="calls-table operator-table">
        <thead>
          <tr>
            <th></th>
            <th>Call</th>
            <th>Date</th>
            <th>Status</th>
            <th>Duration</th>
            <th>Caller request</th>
            <th>Main result</th>
            <th>What went wrong</th>
            <th>Source</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map(c => {
            const ev = evidence.filter(e => e.call_id === c.id);
            const friction = formatFriction(c, ev);
            const dup = duplicateIndex.get(c.id);
            const flags = operationFlags(c);
            const rowClass = [c.pinned ? 'row-pinned' : '', dup ? 'row-duplicate' : ''].filter(Boolean).join(' ');
            const issueLabel = flags[0] || c.primary_issue_label || friction;
            return (
              <tr key={c.id} className={rowClass || undefined} title={dup ? `Duplicate: ${dup.reason}` : undefined}>
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
                  {(c.customer_name || c.phone) && (
                    <div className="table-subline muted-cell">
                      {[c.customer_name, c.phone].filter(Boolean).join(' · ')}
                    </div>
                  )}
                </td>
                <td className="muted-cell">{c.date}</td>
                <td><span className="badge neutral">{c.marie_call_status || c.leaping_status || 'unknown'}</span></td>
                <td className="muted-cell">{fmtDuration(c.duration_seconds)}</td>
                <td><CallerRequestTag category={normalizeCallerRequest(c.anliegen)} /></td>
                <td>
                  {c.marie_main_result ? (
                    <span className="result-pill result-partially">{c.marie_main_result.replace(/_/g, ' ')}</span>
                  ) : (
                    <ResultPill status={c.solved_status} />
                  )}
                </td>
                <td className="clamp-cell" title={issueLabel}>
                  <div className="ops-flag-row">
                    {flags.slice(0, 2).map(flag => <span className="ops-flag" key={flag}>{flag}</span>)}
                    {!flags.length && <span>{issueLabel}</span>}
                  </div>
                </td>
                <td className="muted-cell">{issueSource(ev)} {ev.length ? `(${ev.length})` : ''}</td>
                <td>
                  <div className="btn-group">
                    <button type="button" className="btn-sm primary-soft" onClick={() => onOpen(c)}>View</button>
                    {c.recording_url && (
                      <a className="buttonlike btn-sm" href={c.recording_url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}>
                        Audio
                      </a>
                    )}
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
