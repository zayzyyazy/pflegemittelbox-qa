import type { CallReview } from '../../types/CallReview';
import type { EvidenceMoment } from '../../types/EvidenceMoment';
import { shortCallId } from '../../utils/text';
import { formatFriction } from '../../utils/friction';
import { normalizeCallerRequest } from '../../utils/filterNormalize';
import { CallerRequestTag } from './CallerRequestTag';
import { ResultPill } from './ResultPill';

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
    <table className="calls-table operator-table">
      <thead>
        <tr>
          <th></th>
          <th>Call</th>
          <th>Date</th>
          <th>Kunde</th>
          <th>VNR</th>
          <th>Caller request</th>
          <th>Result</th>
          <th>Rating</th>
          <th>Friction</th>
          <th>Evidence</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {rows.map(c => {
          const ev = evidence.filter(e => e.call_id === c.id);
          const friction = formatFriction(c, ev);
          const dup = duplicateIndex.get(c.id);
          const rowClass = [c.pinned ? 'row-pinned' : '', dup ? 'row-duplicate' : ''].filter(Boolean).join(' ');
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
              </td>
              <td className="muted-cell">{c.date}</td>
              <td className="clamp-cell">{c.customer_name || '—'}</td>
              <td className="muted-cell">{c.vnr || '—'}</td>
              <td><CallerRequestTag category={normalizeCallerRequest(c.anliegen)} /></td>
              <td><ResultPill status={c.solved_status} /></td>
              <td className="muted-cell">{c.overall_rating}</td>
              <td className="clamp-cell">{friction}</td>
              <td className="muted-cell">{ev.length}</td>
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
  );
}
